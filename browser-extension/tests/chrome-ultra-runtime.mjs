import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));
const intelDomains = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "dynamic-intel.json"), "utf8"));

function log(stage, extra = "") { console.log(`[xADKiller CI] ${stage}${extra ? ` • ${extra}` : ""}`); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); })
  ]);
}
function readBuildMeta() {
  const text = fs.readFileSync(path.join(extensionPath, "build-meta.js"), "utf8").trim();
  const match = text.match(/^(?:self|globalThis)\.XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;?$/);
  if (!match) throw new Error("Could not parse generated build-meta.js");
  return JSON.parse(match[1]);
}
async function probeWorker(target) {
  const worker = await target.worker();
  if (!worker) return null;
  try {
    const probe = await worker.evaluate(() => {
      const manifest = chrome.runtime?.getManifest?.() || null;
      return {
        href:self.location.href,
        id:chrome.runtime?.id || "",
        name:manifest?.name || "",
        version:manifest?.version || "",
        permissions:manifest?.permissions || [],
        hasStorage:!!chrome.storage?.local,
        hasAlarms:!!chrome.alarms,
        hasDnr:!!chrome.declarativeNetRequest
      };
    });
    return { worker, probe };
  } catch (_) { return null; }
}
async function findXadWorker(browser, timeoutMs = 22000) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Map();
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const result = await probeWorker(target);
      if (!result) continue;
      seen.set(result.probe.href, result.probe);
      if (result.probe.version === "1.3.1" && result.probe.permissions.includes("declarativeNetRequest")) return { ...result, target };
    }
    await delay(250);
  }
  throw new Error(`xADKiller service worker not found. Seen: ${JSON.stringify([...seen.values()])}`);
}
async function shieldStats(worker) {
  return await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return {
      total:rules.length,
      intel:rules.filter((r) => r.id >= 100000 && r.id <= 123999).length,
      core:rules.filter((r) => r.id >= 130000 && r.id <= 130199).length,
      live:rules.filter((r) => r.id >= 140000 && r.id <= 140899).length,
      matrix:rules.filter((r) => r.id >= 150000 && r.id <= 150399).length,
      custom:rules.filter((r) => r.id >= 910000 && r.id <= 914999).length
    };
  });
}
async function waitShield(worker, minimums, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    last = await shieldStats(worker);
    if (last.intel >= (minimums.intel || 0) && last.live >= (minimums.live || 0) && last.core >= (minimums.core || 0) && last.matrix >= (minimums.matrix || 0)) return last;
    await delay(300);
  }
  throw new Error(`Shield timeout: ${JSON.stringify(last)}`);
}

const meta = readBuildMeta();
if (meta.version !== "1.3.1") throw new Error(`build metadata version mismatch: ${meta.version}`);
if (meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);
if (meta.cosmeticGeneric < 250 || meta.cosmeticDomains < 50) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);
if (!Array.isArray(intelDomains) || intelDomains.length < 18000) throw new Error(`dynamic intelligence pack incomplete: ${intelDomains?.length || 0}`);
if (meta.dynamicIntelDomains !== intelDomains.length) throw new Error(`build metadata dynamic count mismatch: ${meta.dynamicIntelDomains}`);
log("Build artifact meta OK", `v=${meta.version}, STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, packaged=${intelDomains.length}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}`);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
  res.end(testHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
log("HTTP fixture ready", String(port));

let browser = null;
try {
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error(`Chrome for Testing executable missing: ${executablePath}`);
  browser = await withTimeout(puppeteer.launch({
    executablePath,
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],
    timeout:60000
  }), 70000, "Puppeteer Chrome launch");
  log("Chrome launched");

  const found = await findXadWorker(browser);
  const worker = found.worker;
  const extensionId = found.probe.id;
  log("xADKiller worker ready", `${found.probe.version} • ${found.probe.href}`);
  if (!found.probe.hasStorage || !found.probe.hasAlarms || !found.probe.hasDnr) throw new Error(`required extension API missing: ${JSON.stringify(found.probe)}`);
  if (!found.probe.href.endsWith("/service-worker.js")) throw new Error(`unexpected composite worker URL: ${found.probe.href}`);

  const alarms = await worker.evaluate(async () => await chrome.alarms.getAll());
  const alarmNames = alarms.map((a) => a.name);
  if (!alarmNames.includes("xadkiller-live-shield-refresh") || !alarmNames.includes("xadkiller-live-matrix-refresh")) throw new Error(`Live alarms missing: ${alarmNames.join(",")}`);
  log("Live update alarms OK", alarmNames.join(","));

  const initialRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  if (!initialRulesets.includes("standard") || initialRulesets.includes("ultra")) throw new Error(`bad initial rulesets: ${initialRulesets.join(",")}`);

  const standardShield = await waitShield(worker, { intel:15000, live:20, core:10, matrix:15 }, 35000);
  log("STANDARD XAD Shield", JSON.stringify(standardShield));

  const liveCache = await worker.evaluate(async () => await chrome.storage.local.get({
    liveFeedVersion:"", liveStandardDomains:[], liveUltraDomains:[],
    xadLiveMatrixVersion:"", xadLiveSignaturesStandard:[], xadLiveSignaturesUltra:[], xadLiveCosmeticStandard:[], xadLiveCosmeticUltra:[]
  }));
  if (!liveCache.liveFeedVersion || liveCache.liveStandardDomains.length < 20) throw new Error("domain Live Shield cache missing");
  if (liveCache.xadLiveMatrixVersion !== "2026.09.13.2") throw new Error(`Live Matrix version missing/stale: ${liveCache.xadLiveMatrixVersion}`);
  if (liveCache.xadLiveSignaturesStandard.length < 15 || liveCache.xadLiveCosmeticStandard.length < 15) throw new Error(`Live Matrix payload too small: ${JSON.stringify(liveCache)}`);
  log("Live Matrix cache", `${liveCache.xadLiveMatrixVersion} • sig=${liveCache.xadLiveSignaturesStandard.length}/${liveCache.xadLiveSignaturesUltra.length} • css=${liveCache.xadLiveCosmeticStandard.length}/${liveCache.xadLiveCosmeticUltra.length}`);

  const standardMatrixRule = await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return rules.some((r) => r.id >= 150000 && r.id <= 150399 && r.condition?.urlFilter === "/pagead.js");
  });
  if (!standardMatrixRule) throw new Error("Live Signature Matrix did not materialize /pagead.js");

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => { if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || ""; });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(1800);

  const visibleState = await page.evaluate(() => {
    const shadowAd = document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-ad");
    const dynamicAd = document.querySelector("#dynamic-text-ad");
    const liveStyle = document.querySelector("#xadkiller-live-cosmetic");
    return {
      normalVisible:!!document.querySelector("#normal") && getComputedStyle(document.querySelector("#normal")).display !== "none",
      cosmeticVisible:!!document.querySelector("#cosmetic-ad") && getComputedStyle(document.querySelector("#cosmetic-ad")).display !== "none",
      smartVisible:!!document.querySelector("#sponsored-banner-unit") && getComputedStyle(document.querySelector("#sponsored-banner-unit")).display !== "none",
      shadowVisible:!!shadowAd && getComputedStyle(shadowAd).display !== "none" && getComputedStyle(shadowAd).visibility !== "hidden",
      dynamicTextVisible:!!dynamicAd && getComputedStyle(dynamicAd).display !== "none" && getComputedStyle(dynamicAd).visibility !== "hidden",
      liveCssLoaded:!!liveStyle && liveStyle.textContent.includes("data-ad-client"),
      skipClicks:window.skipClicks || 0
    };
  });
  log("DOM assertions", JSON.stringify(visibleState));

  const blockTest = await page.evaluate(async () => await Promise.race([window.blockTest.then((v) => ({ state:"done", value:v })), new Promise((resolve) => setTimeout(() => resolve({ state:"timeout", value:false }), 5000))]));
  const preflightTest = await page.evaluate(async () => await Promise.race([window.preflightTest.then((v) => ({ state:"done", value:v })), new Promise((resolve) => setTimeout(() => resolve({ state:"timeout", value:false }), 5000))]));
  if (!visibleState.normalVisible) throw new Error("normal content was hidden");
  if (visibleState.cosmeticVisible || visibleState.smartVisible || visibleState.shadowVisible || visibleState.dynamicTextVisible) throw new Error(`one or more ad layers remained visible: ${JSON.stringify(visibleState)}`);
  if (!visibleState.liveCssLoaded) throw new Error("Live Cosmetic Matrix CSS not loaded from remote data cache");
  if (visibleState.skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");
  if (preflightTest.state !== "done" || !preflightTest.value) throw new Error("Preflight Guard did not block same-origin ad signature");
  if (blockTest.state === "timeout" || !blockTest.value || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure"}`);

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.select("#mode", "ultra");
  const ultraShield = await waitShield(worker, { intel:23000, live:100, core:25, matrix:40 }, 40000);
  log("ULTRA XAD Shield", JSON.stringify(ultraShield));

  const enabledRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) throw new Error(`ULTRA rulesets not enabled: ${enabledRulesets.join(",")}`);

  const ultraMatrix = await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const r = rules.find((x) => x.id >= 150000 && x.id <= 150399 && x.condition?.urlFilter === "/analytics/");
    return r ? { found:true, domainType:r.condition.domainType, types:r.condition.resourceTypes } : { found:false };
  });
  if (!ultraMatrix.found || ultraMatrix.domainType !== "thirdParty") throw new Error(`ULTRA third-party analytics signature missing: ${JSON.stringify(ultraMatrix)}`);

  log("PASS", `static=${meta.standardRules}+${meta.ultraRules}, packaged=${ultraShield.intel}, liveDomains=${ultraShield.live}, core=${ultraShield.core}, liveMatrix=${ultraShield.matrix}, cosmetic=${meta.cosmeticGeneric}/${meta.cosmeticDomains}`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
  log("Shutdown complete");
}
