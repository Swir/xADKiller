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
    prefs: await chrome.storage.local.get({ enabled:true, mode:"standard" })
  }));
}

async function waitMode(worker, mode, timeout = 18000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await state(worker);
    const set = new Set(last.enabled);
    const ok = mode === "ultra"
      ? set.has("standard") && set.has("ultra") && !set.has("compat") && last.prefs.mode === "ultra"
      : set.has("standard") && set.has("compat") && !set.has("ultra") && last.prefs.mode === "standard";
    if (ok) return last;
    await delay(250);
  }
  throw new Error(`COMPAT transition timeout for ${mode}: ${JSON.stringify(last)}`);
}

assertPack("STANDARD", standardRules, "block", 15000);
assertPack("COMPAT", compatRules, "allow", 1000);
assertPack("ULTRA", ultraRules, "block", 7000);
log("Static policy", `STANDARD=${standardRules.length} BLOCK, COMPAT=${compatRules.length} ALLOW, ULTRA=${ultraRules.length} BLOCK`);

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

  const initial = await waitMode(worker, "standard", 18000);
  log("STANDARD mode", initial.enabled.join(","));

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.select("#mode", "ultra");
  const ultra = await waitMode(worker, "ultra", 22000);
  log("ULTRA mode", ultra.enabled.join(","));

  await popup.select("#mode", "standard");
  const standard = await waitMode(worker, "standard", 22000);
  log("STANDARD restored", standard.enabled.join(","));

  const compatStats = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type:"getCompatStats" }));
  if (!compatStats?.ok || compatStats.active !== true || compatStats.mode !== "standard") {
    throw new Error(`COMPAT stats mismatch: ${JSON.stringify(compatStats)}`);
  }
  log("PASS", `foreign exceptions isolated from ULTRA; own whitelist remains dynamic and separate`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
}
