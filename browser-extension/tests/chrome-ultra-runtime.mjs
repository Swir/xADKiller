import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));

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
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}
async function waitForDevTools(port, timeoutMs, processState) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (processState.exited) throw new Error(`Chrome exited before DevTools became ready (code=${processState.code}, signal=${processState.signal})`);
    try {
      const version = await getJson(`http://127.0.0.1:${port}/json/version`);
      if (version?.webSocketDebuggerUrl) return version;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(250);
  }
  throw new Error(`DevTools endpoint timed out after ${timeoutMs}ms: ${lastError}`);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(testHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
log("HTTP fixture ready", String(port));

const userDataDir = fs.mkdtempSync("/tmp/xadkiller-chrome-ultra-");
const debugPort = await getFreePort();
let chromeProcess = null;
let browser = null;
let context = null;
let stderrTail = "";
const processState = { exited: false, code: null, signal: null };

try {
  const bundledChrome = chromium.executablePath();
  const chromeExecutable = fs.existsSync(bundledChrome)
    ? bundledChrome
    : ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
  if (!chromeExecutable) throw new Error("No Chrome/Chromium executable found");

  log("Launching Chromium headless through DevTools port", `${chromeExecutable} / ${debugPort}`);
  chromeProcess = spawn(chromeExecutable, [
    "--headless=new",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--password-store=basic",
    "--use-mock-keychain",
    "--no-sandbox",
    "about:blank"
  ], {
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  chromeProcess.stdout?.on("data", (chunk) => { process.stdout.write(`[chrome] ${chunk}`); });
  chromeProcess.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-12000);
    process.stderr.write(`[chrome] ${text}`);
  });
  chromeProcess.once("exit", (code, signal) => {
    processState.exited = true;
    processState.code = code;
    processState.signal = signal;
  });

  const version = await waitForDevTools(debugPort, 30000, processState);
  log("DevTools endpoint ready", version.Browser || "Chrome");

  browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`), 15000, "CDP connection");
  context = browser.contexts()[0];
  if (!context) throw new Error("Chrome default browser context not found over CDP");
  log("CDP connected");

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await withTimeout(context.waitForEvent("serviceworker", { timeout: 20000 }), 22000, "service worker");
  const extensionId = new URL(worker.url()).host;
  if (!extensionId) throw new Error("could not resolve extension id");
  log("Service worker ready", extensionId);

  const meta = await withTimeout(worker.evaluate(() => self.XAD_BUILD_META || null), 8000, "build meta");
  if (!meta || meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);
  if (meta.cosmeticGeneric < 250 || meta.cosmeticDomains < 50) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);
  log("Build meta OK", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}`);

  const page = await withTimeout(context.newPage(), 8000, "test page creation");
  page.setDefaultTimeout(10000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  log("Opening local runtime fixture");
  await withTimeout(page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 10000 }), 12000, "fixture navigation");
  await page.waitForTimeout(1200);
  log("Fixture loaded");

  const visibleState = await withTimeout(page.evaluate(() => ({
    normalVisible: !!document.querySelector("#normal") && getComputedStyle(document.querySelector("#normal")).display !== "none",
    cosmeticVisible: !!document.querySelector("#cosmetic-ad") && getComputedStyle(document.querySelector("#cosmetic-ad")).display !== "none",
    smartVisible: !!document.querySelector("#sponsored-banner-unit") && getComputedStyle(document.querySelector("#sponsored-banner-unit")).display !== "none",
    skipClicks: window.skipClicks || 0
  })), 10000, "DOM assertions");
  log("DOM assertions returned", JSON.stringify(visibleState));

  const blockTest = await withTimeout(page.evaluate(async () => await Promise.race([
    window.blockTest.then((v) => ({ state: "done", value: v })),
    new Promise((resolve) => setTimeout(() => resolve({ state: "timeout", value: false }), 5000))
  ])), 8000, "DNR control request");
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
  }, `127.0.0.1:${port}`), 8000, "tab id lookup");
  if (testTabId < 0) throw new Error("test tab id not found");
  log("Test tab identified", String(testTabId));

  const matched = await withTimeout(worker.evaluate(async (tabId) => {
    try {
      const details = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      return { ok: true, count: details?.rulesMatchedInfo?.length || 0 };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, testTabId), 8000, "matched rules lookup");
  if (!matched.ok) throw new Error(`getMatchedRules failed: ${matched.error || "unknown"}`);
  if (matched.count < 1) throw new Error("DNR reported zero matched rules for the test tab");
  log("Matched rules OK", String(matched.count));

  const popup = await withTimeout(context.newPage(), 8000, "popup page creation");
  popup.setDefaultTimeout(10000);
  log("Opening extension popup page");
  await withTimeout(popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 10000 }), 12000, "popup navigation");
  await withTimeout(popup.selectOption("#mode", "ultra"), 10000, "ULTRA select");
  await popup.waitForTimeout(1000);
  const enabledRulesets = await withTimeout(worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets()), 8000, "enabled rulesets");
  log("Popup mode switch returned", enabledRulesets.join(","));
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) {
    throw new Error(`ULTRA rulesets not enabled through popup: ${enabledRulesets.join(",")}`);
  }

  log("PASS", `STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetic=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}, matched=${matched.count}`);
} catch (error) {
  if (stderrTail) console.error("[xADKiller CI] Chrome stderr tail:\n" + stderrTail);
  throw error;
} finally {
  log("Shutting down Chromium");
  if (browser) {
    try { await withTimeout(browser.close(), 6000, "CDP browser close"); } catch (error) { console.warn(String(error)); }
  }
  if (chromeProcess && !processState.exited) {
    try { process.kill(-chromeProcess.pid, "SIGTERM"); } catch (_) {
      try { chromeProcess.kill("SIGTERM"); } catch (_) {}
    }
    await delay(700);
    if (!processState.exited) {
      try { process.kill(-chromeProcess.pid, "SIGKILL"); } catch (_) {
        try { chromeProcess.kill("SIGKILL"); } catch (_) {}
      }
    }
  }
  await new Promise((resolve) => server.close(resolve));
  log("Shutdown complete");
}
