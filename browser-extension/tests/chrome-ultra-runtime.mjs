import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));

function log(stage, extra = "") {
  console.log(`[xADKiller CI] ${stage}${extra ? ` • ${extra}` : ""}`);
}
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(testHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
log("HTTP fixture ready", String(port));

const userDataDir = fs.mkdtempSync("/tmp/xadkiller-chrome-ultra-");
let context = null;

try {
  log("Launching Chromium");
  context = await withTimeout(chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 20000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox"
    ]
  }), 25000, "Chromium launch");
  log("Chromium launched");

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await withTimeout(context.waitForEvent("serviceworker", { timeout: 10000 }), 12000, "service worker");
  const extensionId = new URL(worker.url()).host;
  if (!extensionId) throw new Error("could not resolve extension id");
  log("Service worker ready", extensionId);

  const meta = await withTimeout(worker.evaluate(() => self.XAD_BUILD_META || null), 6000, "build meta");
  if (!meta || meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);
  if (meta.cosmeticGeneric < 250 || meta.cosmeticDomains < 50) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);
  log("Build meta OK", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}`);

  const page = await withTimeout(context.newPage(), 5000, "test page creation");
  page.setDefaultTimeout(8000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  log("Opening local runtime fixture");
  await withTimeout(page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 8000 }), 10000, "fixture navigation");
  await page.waitForTimeout(1000);
  log("Fixture loaded");

  const visibleState = await withTimeout(page.evaluate(() => ({
    normalVisible: !!document.querySelector("#normal") && getComputedStyle(document.querySelector("#normal")).display !== "none",
    cosmeticVisible: !!document.querySelector("#cosmetic-ad") && getComputedStyle(document.querySelector("#cosmetic-ad")).display !== "none",
    smartVisible: !!document.querySelector("#sponsored-banner-unit") && getComputedStyle(document.querySelector("#sponsored-banner-unit")).display !== "none",
    skipClicks: window.skipClicks || 0
  })), 8000, "DOM assertions");
  log("DOM assertions returned", JSON.stringify(visibleState));

  const blockTest = await withTimeout(page.evaluate(async () => await Promise.race([
    window.blockTest.then((v) => ({ state: "done", value: v })),
    new Promise((resolve) => setTimeout(() => resolve({ state: "timeout", value: false }), 4000))
  ])), 6000, "DNR control request");
  log("DNR request finished", `${JSON.stringify(blockTest)} / ${dnrFailure || "no failure text"}`);

  if (!visibleState.normalVisible) throw new Error("normal content was hidden");
  if (visibleState.cosmeticVisible) throw new Error("cosmetic ad was not hidden");
  if (visibleState.smartVisible) throw new Error("Smart DOM did not hide strong ad candidate");
  if (visibleState.skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");
  if (blockTest.state === "timeout") throw new Error("DNR control request timed out instead of being blocked");
  if (!blockTest.value || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure captured"}`);

  const testTabId = await withTimeout(worker.evaluate(async (urlPart) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || "").includes(urlPart))?.id || -1;
  }, `127.0.0.1:${port}`), 5000, "tab id lookup");
  if (testTabId < 0) throw new Error("test tab id not found");
  log("Test tab identified", String(testTabId));

  const matched = await withTimeout(worker.evaluate(async (tabId) => {
    try {
      const details = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      return { ok: true, count: details?.rulesMatchedInfo?.length || 0 };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, testTabId), 5000, "matched rules lookup");
  if (!matched.ok) throw new Error(`getMatchedRules failed: ${matched.error || "unknown"}`);
  if (matched.count < 1) throw new Error("DNR reported zero matched rules for the test tab");
  log("Matched rules OK", String(matched.count));

  // Test the same path a real user uses: popup UI -> runtime message -> DNR ruleset switch.
  const popup = await withTimeout(context.newPage(), 5000, "popup page creation");
  popup.setDefaultTimeout(8000);
  log("Opening extension popup page");
  await withTimeout(popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 8000 }), 10000, "popup navigation");
  await withTimeout(popup.selectOption("#mode", "ultra"), 8000, "ULTRA select");
  await popup.waitForTimeout(700);
  const enabledRulesets = await withTimeout(worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets()), 5000, "enabled rulesets");
  log("Popup mode switch returned", enabledRulesets.join(","));
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) {
    throw new Error(`ULTRA rulesets not enabled through popup: ${enabledRulesets.join(",")}`);
  }

  log("PASS", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}, matched=${matched.count}`);
} finally {
  log("Shutting down Chromium");
  if (context) {
    try { await withTimeout(context.close(), 6000, "Chromium close"); } catch (error) { console.warn(String(error)); }
  }
  await new Promise((resolve) => server.close(resolve));
  log("Shutdown complete");
}
