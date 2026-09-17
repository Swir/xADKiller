import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));
const intelDomains = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "dynamic-intel.json"), "utf8"));
const titanSessionPack = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "titan-session.json"), "utf8"));
const standardStatic = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "standard.json"), "utf8"));

function log(stage, extra = "") { console.log(`[xADKiller TITAN CI] ${stage}${extra ? ` • ${extra}` : ""}`); }
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
        hasDnr:!!chrome.declarativeNetRequest,
        hasSession:typeof chrome.declarativeNetRequest?.getSessionRules === "function",
        hasRegexCheck:typeof chrome.declarativeNetRequest?.isRegexSupported === "function"
      };
    });
    return { worker, probe };
  } catch (_) { return null; }
}
async function findXadWorker(browser, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const result = await probeWorker(target);
      if (!result) continue;
      seen.push(result.probe);
      if (result.probe.version === "1.4.0" && result.probe.permissions.includes("declarativeNetRequest")) return result;
    }
    await delay(250);
  }
  throw new Error(`xADKiller TITAN worker not found. Seen: ${JSON.stringify(seen.slice(-10))}`);
}
async function shieldStats(worker) {
  return await worker.evaluate(async () => {
    const [dynamic, session] = await Promise.all([
      chrome.declarativeNetRequest.getDynamicRules(),
      chrome.declarativeNetRequest.getSessionRules()
    ]);
    return {
      dynamicTotal:dynamic.length,
      intel:dynamic.filter((r) => r.id >= 100000 && r.id <= 123999).length,
      core:dynamic.filter((r) => r.id >= 130000 && r.id <= 130199).length,
      live:dynamic.filter((r) => r.id >= 140000 && r.id <= 140899).length,
      matrix:dynamic.filter((r) => r.id >= 150000 && r.id <= 150399).length,
      regex:dynamic.filter((r) => r.id >= 160000 && r.id <= 160199).length,
      custom:dynamic.filter((r) => r.id >= 910000 && r.id <= 914999).length,
      session:session.filter((r) => r.id >= 200000 && r.id <= 204499).length,
      learned:session.filter((r) => r.id >= 290000 && r.id <= 290299).length,
      sessionTotal:session.length
    };
  });
}
async function waitShield(worker, minimums, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    last = await shieldStats(worker);
    const ok = Object.entries(minimums).every(([k,v]) => Number(last[k] || 0) >= v);
    if (ok) return last;
    await delay(350);
  }
  throw new Error(`TITAN Shield timeout: ${JSON.stringify(last)} expected=${JSON.stringify(minimums)}`);
}
async function waitAlarms(worker, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let names = [];
  while (Date.now() < deadline) {
    const alarms = await worker.evaluate(async () => await chrome.alarms.getAll());
    names = alarms.map((a) => a.name);
    if (expected.every((name) => names.includes(name))) return names;
    await delay(200);
  }
  throw new Error(`startup alarms timeout: expected=${expected.join(",")} seen=${names.join(",")}`);
}

const meta = readBuildMeta();
if (meta.version !== "1.4.0") throw new Error(`build metadata version mismatch: ${meta.version}`);
if (meta.standardRules < 15000 || meta.ultraRules < 7000) throw new Error(`invalid static build meta: ${JSON.stringify(meta)}`);
if (meta.cosmeticGeneric < 500 || meta.cosmeticDomains < 100) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);
if (!Array.isArray(intelDomains) || intelDomains.length < 18000) throw new Error(`dynamic intelligence pack incomplete: ${intelDomains?.length || 0}`);
if (!Array.isArray(titanSessionPack) || titanSessionPack.length < 1200) throw new Error(`TITAN session pack incomplete: ${titanSessionPack?.length || 0}`);
if (meta.dynamicIntelDomains !== intelDomains.length) throw new Error(`build metadata dynamic count mismatch: ${meta.dynamicIntelDomains}`);
if (meta.titanSessionRules !== titanSessionPack.length) throw new Error(`build metadata session count mismatch: ${meta.titanSessionRules}`);
if (!standardStatic.some((r) => /^\/(?:ads?|pagead|prebid)/i.test(String(r?.condition?.urlFilter || "")))) throw new Error("leading-slash ad URL filters were still lost by compiler");
if (!titanSessionPack.some((r) => /(?:pagead|prebid|adserver|adservice|\/ads?)/i.test(String(r?.condition?.urlFilter || "")))) throw new Error("TITAN session pack lacks aggressive ad paths");
const standardSessionFloor = Math.min(2000, titanSessionPack.length);
const ultraSessionFloor = Math.min(4000, titanSessionPack.length);
log("Build artifact meta OK", `v=${meta.version}, static=${meta.standardRules}+${meta.ultraRules}, dynamicPack=${intelDomains.length}, sessionPack=${titanSessionPack.length}, cosmetic=${meta.cosmeticGeneric}/${meta.cosmeticDomains}`);

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
  log("TITAN worker ready", `${found.probe.version} • ${found.probe.href}`);
  if (!found.probe.hasStorage || !found.probe.hasAlarms || !found.probe.hasDnr || !found.probe.hasSession || !found.probe.hasRegexCheck) throw new Error(`required TITAN API missing: ${JSON.stringify(found.probe)}`);

  const alarmNames = await waitAlarms(worker, ["xadkiller-live-shield-refresh","xadkiller-live-matrix-refresh","xadkiller-titan-refresh"], 10000);
  log("Update alarms OK", alarmNames.join(","));

  const initialRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  if (!initialRulesets.includes("standard") || initialRulesets.includes("ultra")) throw new Error(`bad initial rulesets: ${initialRulesets.join(",")}`);

  const standardShield = await waitShield(worker, { intel:15000, live:20, core:10, matrix:15, regex:1, session:standardSessionFloor }, 50000);
  log("STANDARD TITAN Shield", JSON.stringify(standardShield));

  const titanCache = await worker.evaluate(async () => await chrome.storage.local.get({ xadTitanFeed:null, xadTitanFetchedAt:0 }));
  if (!titanCache.xadTitanFeed?.version || !Array.isArray(titanCache.xadTitanFeed?.regex) || titanCache.xadTitanFeed.regex.length < 2) throw new Error(`TITAN remote data cache missing: ${JSON.stringify(titanCache)}`);
  log("TITAN feed", `${titanCache.xadTitanFeed.version} • regex=${titanCache.xadTitanFeed.regex.length}`);

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => { if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || ""; });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(2000);

  const visibleState = await page.evaluate(() => {
    const shadowAd = document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#shadow-ad");
    const closedShadowAd = window.__xadClosedShadowAdRef;
    const dynamicAd = document.querySelector("#dynamic-text-ad");
    return {
      normalVisible:!!document.querySelector("#normal") && getComputedStyle(document.querySelector("#normal")).display !== "none",
      cosmeticVisible:!!document.querySelector("#cosmetic-ad") && getComputedStyle(document.querySelector("#cosmetic-ad")).display !== "none",
      smartVisible:!!document.querySelector("#sponsored-banner-unit") && getComputedStyle(document.querySelector("#sponsored-banner-unit")).display !== "none",
      shadowVisible:!!shadowAd && getComputedStyle(shadowAd).display !== "none" && getComputedStyle(shadowAd).visibility !== "hidden",
      closedShadowVisible:!!closedShadowAd && getComputedStyle(closedShadowAd).display !== "none" && getComputedStyle(closedShadowAd).visibility !== "hidden",
      dynamicTextVisible:!!dynamicAd && getComputedStyle(dynamicAd).display !== "none" && getComputedStyle(dynamicAd).visibility !== "hidden",
      skipClicks:window.skipClicks || 0
    };
  });
  log("DOM assertions", JSON.stringify(visibleState));
  if (!visibleState.normalVisible) throw new Error("normal content was hidden");
  if (visibleState.cosmeticVisible || visibleState.smartVisible || visibleState.shadowVisible || visibleState.closedShadowVisible || visibleState.dynamicTextVisible) throw new Error(`one or more ad layers remained visible: ${JSON.stringify(visibleState)}`);
  if (visibleState.skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");

  const blockTest = await page.evaluate(async () => await Promise.race([window.blockTest.then((v) => ({ state:"done", value:v })), new Promise((resolve) => setTimeout(() => resolve({ state:"timeout", value:false }), 5000))]));
  const preflightTest = await page.evaluate(async () => await Promise.race([window.preflightTest.then((v) => ({ state:"done", value:v })), new Promise((resolve) => setTimeout(() => resolve({ state:"timeout", value:false }), 5000))]));
  if (preflightTest.state !== "done" || !preflightTest.value) throw new Error("Preflight Guard did not block first-party ad signature");
  if (blockTest.state === "timeout" || !blockTest.value || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure"}`);

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.select("#mode", "ultra");
  const ultraShield = await waitShield(worker, { intel:23000, live:100, core:25, matrix:35, regex:3, session:ultraSessionFloor }, 50000);
  log("ULTRA TITAN Shield", JSON.stringify(ultraShield));

  await delay(500);
  const mainGuards = await page.evaluate(() => {
    let workerBlocked = false;
    try { new Worker("/ads/worker.js"); } catch (_) { workerBlocked = true; }
    const popupBlocked = window.open("/ads/popup") === null;
    const holder = document.createElement("div");
    document.body.appendChild(holder);
    holder.insertAdjacentHTML("beforeend", '<iframe id="titan-injected-ad" src="/adserver/frame"></iframe>');
    const markupBlocked = !document.getElementById("titan-injected-ad");
    holder.remove();
    return { workerBlocked, popupBlocked, markupBlocked };
  });
  if (!mainGuards.workerBlocked || !mainGuards.popupBlocked || !mainGuards.markupBlocked) throw new Error(`TITAN MAIN-world guard incomplete: ${JSON.stringify(mainGuards)}`);
  log("TITAN MAIN-world guards", JSON.stringify(mainGuards));

  const learnResult = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type:"titanLearnResource", url:"https://cdn-adnxs.example.net/runtime/ad.js", pageHost:"example.org" }));
  if (!learnResult?.ok) throw new Error(`adaptive learner rejected strong signal: ${JSON.stringify(learnResult)}`);
  const learnedShield = await waitShield(worker, { learned:1, session:ultraSessionFloor }, 8000);
  log("Adaptive session learner", JSON.stringify({ learned:learnedShield.learned }));

  const enabledRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) throw new Error(`ULTRA rulesets not enabled: ${enabledRulesets.join(",")}`);

  log("PASS", `static=${meta.standardRules}+${meta.ultraRules}, dynamicIntel=${ultraShield.intel}, live=${ultraShield.live}, matrix=${ultraShield.matrix}, regex=${ultraShield.regex}, session=${ultraShield.session}/${titanSessionPack.length}, learned=${learnedShield.learned}, cosmetic=${meta.cosmeticGeneric}/${meta.cosmeticDomains}`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
  log("Shutdown complete");
}
