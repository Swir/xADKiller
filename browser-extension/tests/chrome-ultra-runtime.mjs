import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));
const intelDomains = JSON.parse(fs.readFileSync(path.join(extensionPath, "rules", "dynamic-intel.json"), "utf8"));

function log(stage, extra = "") {
  console.log(`[xADKiller CI] ${stage}${extra ? ` • ${extra}` : ""}`);
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}
function readBuildMeta() {
  const file = path.join(extensionPath, "build-meta.js");
  const text = fs.readFileSync(file, "utf8").trim();
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
        href: self.location.href,
        id: chrome.runtime?.id || "",
        name: manifest?.name || "",
        version: manifest?.version || "",
        permissions: manifest?.permissions || [],
        hasStorage: !!chrome.storage?.local,
        hasDnr: !!chrome.declarativeNetRequest,
        dnrMethods: chrome.declarativeNetRequest ? Object.keys(chrome.declarativeNetRequest).sort() : []
      };
    });
    return { worker, probe };
  } catch (_) {
    return null;
  }
}
async function findXadWorker(browser, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Map();
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const result = await probeWorker(target);
      if (!result) continue;
      const { probe } = result;
      seen.set(probe.href, probe);
      if (probe.version === "1.2.0" && probe.permissions.includes("declarativeNetRequest")) return { ...result, target };
    }
    await delay(250);
  }
  throw new Error(`xADKiller service worker not found. Seen: ${JSON.stringify([...seen.values()])}`);
}
async function waitDynamicShield(worker, minimumIntel, minimumCore = 0, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = { total: 0, intel: 0, core: 0 };
  while (Date.now() < deadline) {
    last = await worker.evaluate(async () => {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return {
        total: rules.length,
        intel: rules.filter((r) => r.id >= 100000 && r.id <= 123999).length,
        core: rules.filter((r) => r.id >= 130000 && r.id <= 130099).length
      };
    });
    if (last.intel >= minimumIntel && last.core >= minimumCore) return last;
    await delay(250);
  }
  throw new Error(`Dynamic Shield timeout: ${JSON.stringify(last)}`);
}

const meta = readBuildMeta();
if (meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);
if (meta.cosmeticGeneric < 250 || meta.cosmeticDomains < 50) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);
if (!Array.isArray(intelDomains) || intelDomains.length < 18000) throw new Error(`dynamic intelligence pack incomplete: ${intelDomains?.length || 0}`);
log("Build artifact meta OK", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, dynamic=${intelDomains.length}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}`);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(testHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
log("HTTP fixture ready", String(port));

let browser = null;
try {
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error(`Chrome for Testing executable missing: ${executablePath}`);

  log("Launching Chrome for Testing with Puppeteer enableExtensions", executablePath);
  browser = await withTimeout(puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
    args: ["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],
    timeout: 60000
  }), 70000, "Puppeteer Chrome launch");
  log("Chrome launched");

  const extensionList = await withTimeout(browser.extensions(), 8000, "extension inventory");
  log("Installed extension inventory", JSON.stringify([...extensionList.values()].map((e) => ({ id: e.id, name: e.name, version: e.version }))));

  const found = await withTimeout(findXadWorker(browser), 22000, "xADKiller service worker");
  const worker = found.worker;
  const runtimeProbe = found.probe;
  const extensionId = runtimeProbe.id;
  log("xADKiller service worker ready", `${extensionId} / ${runtimeProbe.href}`);
  log("Extension API probe", JSON.stringify(runtimeProbe));
  if (!runtimeProbe.hasStorage) throw new Error("chrome.storage.local unavailable in xADKiller worker");
  if (!runtimeProbe.hasDnr) throw new Error("chrome.declarativeNetRequest unavailable in xADKiller worker");

  const initialRulesets = await withTimeout(worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets()), 8000, "initial rulesets");
  if (!initialRulesets.includes("standard")) throw new Error(`STANDARD ruleset not enabled: ${initialRulesets.join(",")}`);
  if (initialRulesets.includes("ultra")) throw new Error(`ULTRA unexpectedly enabled initially: ${initialRulesets.join(",")}`);
  log("Initial DNR rulesets OK", initialRulesets.join(","));

  const standardShield = await waitDynamicShield(worker, 15000, 0, 25000);
  log("STANDARD Dynamic Shield", JSON.stringify(standardShield));

  const sampleDomain = intelDomains[0];
  const samplePresent = await worker.evaluate(async (domain) => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return rules.some((r) => Array.isArray(r.condition?.requestDomains) && r.condition.requestDomains.includes(domain));
  }, sampleDomain);
  if (!samplePresent) throw new Error(`dynamic intelligence sample not installed: ${sampleDomain}`);

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  log("Opening local runtime fixture");
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 12000 });
  await delay(1500);

  const visibleState = await page.evaluate(() => ({
    normalVisible: !!document.querySelector("#normal") && getComputedStyle(document.querySelector("#normal")).display !== "none",
    cosmeticVisible: !!document.querySelector("#cosmetic-ad") && getComputedStyle(document.querySelector("#cosmetic-ad")).display !== "none",
    smartVisible: !!document.querySelector("#sponsored-banner-unit") && getComputedStyle(document.querySelector("#sponsored-banner-unit")).display !== "none",
    skipClicks: window.skipClicks || 0
  }));
  log("DOM assertions", JSON.stringify(visibleState));

  const blockTest = await page.evaluate(async () => await Promise.race([
    window.blockTest.then((v) => ({ state: "done", value: v })),
    new Promise((resolve) => setTimeout(() => resolve({ state: "timeout", value: false }), 5000))
  ]));
  log("DNR request", `${JSON.stringify(blockTest)} / ${dnrFailure || "no failure text"}`);

  if (!visibleState.normalVisible) throw new Error("normal content was hidden");
  if (visibleState.cosmeticVisible) throw new Error("cosmetic ad was not hidden");
  if (visibleState.smartVisible) throw new Error("Smart DOM did not hide strong ad candidate");
  if (visibleState.skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");
  if (blockTest.state === "timeout") throw new Error("DNR request timed out instead of being blocked");
  if (!blockTest.value || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure captured"}`);

  const testTabId = await worker.evaluate(async (urlPart) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || "").includes(urlPart))?.id || -1;
  }, `127.0.0.1:${port}`);
  if (testTabId < 0) throw new Error("test tab id not found");

  const matched = await worker.evaluate(async (tabId) => {
    try {
      const details = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      return { ok: true, count: details?.rulesMatchedInfo?.length || 0 };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, testTabId);
  if (!matched.ok) throw new Error(`getMatchedRules failed: ${matched.error}`);
  if (matched.count < 1) throw new Error("DNR reported zero matched rules");
  log("Matched DNR rules", String(matched.count));

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 12000 });
  await popup.select("#mode", "ultra");

  const enabledRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  log("Popup ULTRA switch", enabledRulesets.join(","));
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) {
    throw new Error(`ULTRA rulesets not enabled through popup: ${enabledRulesets.join(",")}`);
  }

  const ultraShield = await waitDynamicShield(worker, 23000, 10, 30000);
  log("ULTRA Dynamic Shield", JSON.stringify(ultraShield));

  log("PASS", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, dynamic=${ultraShield.intel}, core=${ultraShield.core}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}, matched=${matched.count}`);
} finally {
  log("Shutting down Chrome");
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
  await new Promise((resolve) => server.close(resolve));
  log("Shutdown complete");
}
