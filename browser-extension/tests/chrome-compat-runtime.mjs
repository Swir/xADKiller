import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const standardRules = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "standard.json"), "utf8"));
const compatRules = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "compat.json"), "utf8"));
const ultraRules = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "ultra.json"), "utf8"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function log(stage, extra = "") { console.log(`[xADKiller COMPAT CI] ${stage}${extra ? ` • ${extra}` : ""}`); }

function assertPack(name, rules, action, min) {
  if (!Array.isArray(rules) || rules.length < min) throw new Error(`${name} too small: ${rules?.length || 0}`);
  const bad = rules.find((r) => r?.action?.type !== action);
  if (bad) throw new Error(`${name} contains ${bad?.action?.type || "unknown"} rule id=${bad?.id}`);
}

async function findWorker(browser, timeout = 22000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest.version === "1.4.0" && manifest.name.includes("xADKiller")) return worker;
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller COMPAT worker not found");
}

async function state(worker) {
  return await worker.evaluate(async () => ({
    enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
    prefs: await chrome.storage.local.get({ enabled:true, mode:"standard", compatEnabled:false })
  }));
}

async function waitPolicy(worker, { mode, compat }, timeout = 18000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await state(worker);
    const set = new Set(last.enabled);
    const modeOk = mode === "ultra"
      ? set.has("standard") && set.has("ultra")
      : set.has("standard") && !set.has("ultra");
    const compatOk = compat ? set.has("compat") : !set.has("compat");
    const prefsOk = last.prefs.mode === mode && last.prefs.compatEnabled === compat;
    if (modeOk && compatOk && prefsOk) return last;
    await delay(250);
  }
  throw new Error(`COMPAT policy timeout: mode=${mode}, compat=${compat}, state=${JSON.stringify(last)}`);
}

async function openPopup(browser, extensionId, expectedMode = null) {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  if (expectedMode) {
    await popup.waitForFunction((mode) => {
      const el = document.querySelector("#mode");
      return !!el && el.value === mode;
    }, { timeout:12000 }, expectedMode);
  }
  return popup;
}

assertPack("STANDARD", standardRules, "block", 15000);
assertPack("COMPAT", compatRules, "allow", 1000);
assertPack("ULTRA", ultraRules, "block", 7000);
log("Static policy", `STANDARD=${standardRules.length} BLOCK, COMPAT=${compatRules.length} ALLOW(opt-in), ULTRA=${ultraRules.length} BLOCK`);

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    timeout: 60000
  });
  const worker = await findWorker(browser);
  const extensionId = await worker.evaluate(() => chrome.runtime.id);

  const initial = await waitPolicy(worker, { mode:"standard", compat:false }, 18000);
  log("STANDARD default", initial.enabled.join(","));

  const enableCompat = await worker.evaluate(async () => await chrome.runtime.sendMessage({ type:"setCompatEnabled", compatEnabled:true }));
  if (!enableCompat?.ok) throw new Error(`could not opt in COMPAT: ${JSON.stringify(enableCompat)}`);
  const compatOn = await waitPolicy(worker, { mode:"standard", compat:true }, 18000);
  log("STANDARD + explicit COMPAT", compatOn.enabled.join(","));

  let popup = await openPopup(browser, extensionId, "standard");
  await popup.select("#mode", "ultra");
  const ultra = await waitPolicy(worker, { mode:"ultra", compat:true }, 22000);
  if (ultra.enabled.includes("compat")) throw new Error(`COMPAT must be suppressed in ULTRA: ${ultra.enabled.join(",")}`);
  log("ULTRA suppresses COMPAT", ultra.enabled.join(","));
  await popup.close();

  popup = await openPopup(browser, extensionId, "ultra");
  await popup.select("#mode", "standard");
  const standardRestored = await waitPolicy(worker, { mode:"standard", compat:true }, 22000);
  if (!standardRestored.enabled.includes("compat")) throw new Error(`explicit COMPAT did not return in STANDARD: ${standardRestored.enabled.join(",")}`);
  log("STANDARD explicit COMPAT restored", standardRestored.enabled.join(","));

  const disableCompat = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type:"setCompatEnabled", compatEnabled:false }));
  if (!disableCompat?.ok) throw new Error(`could not disable COMPAT: ${JSON.stringify(disableCompat)}`);
  const finalState = await waitPolicy(worker, { mode:"standard", compat:false }, 18000);
  if (finalState.enabled.includes("compat")) throw new Error(`COMPAT still active after opt-out: ${finalState.enabled.join(",")}`);

  const compatStats = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type:"getCompatStats" }));
  if (!compatStats?.ok || compatStats.active !== false || compatStats.requested !== false || compatStats.mode !== "standard") {
    throw new Error(`COMPAT stats mismatch: ${JSON.stringify(compatStats)}`);
  }
  await popup.close();
  log("PASS", "COMPAT ships OFF, only explicit opt-in can enable it, ULTRA always suppresses it");
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
}
