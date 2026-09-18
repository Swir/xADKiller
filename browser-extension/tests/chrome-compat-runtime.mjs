import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"));
const standardRules = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "standard.json"), "utf8"));
const ultraRules = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "ultra.json"), "utf8"));
const compatPath = path.join(extensionPath, "rules", "compat.json");
const compatRules = fs.existsSync(compatPath) ? JSON.parse(fs.readFileSync(compatPath, "utf8")) : [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function log(stage, extra = "") { console.log(`[xADKiller NO-ALLOW CI] ${stage}${extra ? ` • ${extra}` : ""}`); }

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
        const m = await worker.evaluate(() => chrome.runtime.getManifest());
        if (m.version === "1.4.0" && m.name.includes("xADKiller")) return worker;
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller worker not found");
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    timeout: 60000
  });
}

async function launchWithWorker() {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const candidate = await launchBrowser();
    try {
      // A cold Chromium profile can very occasionally delay the MV3 worker target even
      // though the same extension package is healthy. Retry only this startup discovery
      // failure in a fresh browser; all no-COMPAT/mode assertions below remain strict.
      const worker = await findWorker(candidate, attempt === 1 ? 14000 : 22000);
      if (attempt > 1) log("Worker startup recovered", "fresh Chromium retry");
      return { browser:candidate, worker };
    } catch (error) {
      lastError = error;
      try { await candidate.close(); } catch (_) {}
      if (!String(error?.message || error).includes("worker not found") || attempt === 2) throw error;
      log("Worker startup retry", "MV3 service worker target was late; retrying fresh Chromium once");
    }
  }
  throw lastError || new Error("xADKiller worker not found");
}

async function snapshot(worker) {
  return await worker.evaluate(async () => ({
    enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
    prefs: await chrome.storage.local.get({ enabled:true, mode:"standard" })
  }));
}

async function waitMode(worker, mode, timeout = 18000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await snapshot(worker);
    const set = new Set(last.enabled);
    const coreOk = mode === "ultra"
      ? set.has("standard") && set.has("ultra")
      : set.has("standard") && !set.has("ultra");
    if (coreOk && !set.has("compat") && last.prefs.mode === mode) return last;
    await delay(250);
  }
  throw new Error(`mode/no-allow timeout for ${mode}: ${JSON.stringify(last)}`);
}

async function openPopup(browser, extensionId, expectedMode) {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.waitForFunction((mode) => document.querySelector("#mode")?.value === mode, { timeout:12000 }, expectedMode);
  return popup;
}

assertPack("STANDARD", standardRules, "block", 15000);
assertPack("ULTRA", ultraRules, "block", 7000);
if (compatRules.length && compatRules.some((r) => r?.action?.type !== "allow")) throw new Error("dormant COMPAT source contains non-allow rule");
const resources = manifest.declarative_net_request?.rule_resources || [];
if (resources.some((r) => r.id === "compat")) throw new Error("COMPAT ruleset is still referenced by manifest");
log("Manifest policy", `STANDARD=${standardRules.length} BLOCK, ULTRA=${ultraRules.length} BLOCK, COMPAT=unreferenced`);

let browser = null;
try {
  const session = await launchWithWorker();
  browser = session.browser;
  const worker = session.worker;
  const extensionId = await worker.evaluate(() => chrome.runtime.id);

  const initial = await waitMode(worker, "standard", 18000);
  log("STANDARD", initial.enabled.join(","));

  let popup = await openPopup(browser, extensionId, "standard");
  await popup.select("#mode", "ultra");
  const ultra = await waitMode(worker, "ultra", 22000);
  log("ULTRA", ultra.enabled.join(","));
  await popup.close();

  popup = await openPopup(browser, extensionId, "ultra");
  await popup.select("#mode", "standard");
  const restored = await waitMode(worker, "standard", 22000);
  log("STANDARD restored", restored.enabled.join(","));
  await popup.close();

  const compatCanActivate = await worker.evaluate(async () => {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds:["compat"], disableRulesetIds:[] });
      return (await chrome.declarativeNetRequest.getEnabledRulesets()).includes("compat");
    } catch (_) {
      return false;
    }
  });
  if (compatCanActivate) throw new Error("COMPAT allow ruleset could still be activated");

  log("PASS", "no manifest-referenced ALLOW compatibility rules survive in STANDARD or ULTRA");
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
}
