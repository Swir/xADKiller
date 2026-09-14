import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller PAUSE CI] ${stage}${extra ? ` • ${extra}` : ""}`);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pause fixture</title></head><body>
<div id="normal">NORMAL CONTENT</div>
<div id="ad" class="adsbygoogle" style="width:300px;height:90px">ADVERTISEMENT</div>
</body></html>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function findWorker(browser, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name?.includes("xADKiller") && manifest?.permissions?.includes("declarativeNetRequest")) {
          return { worker, extensionId:await worker.evaluate(() => chrome.runtime.id) };
        }
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not found");
}

async function send(page, payload) {
  return await page.evaluate(async (message) => await chrome.runtime.sendMessage(message), payload);
}

async function pauseRules(worker) {
  return await worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= 905000 && r.id <= 905199));
}

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath:chromium.executablePath(),
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:[
      "--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
      "--host-resolver-rules=MAP pause.xad.test 127.0.0.1"
    ],
    timeout:60000
  });
  const { worker, extensionId } = await findWorker(browser);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });

  const start = await send(popup, { type:"setTemporarySitePause", host:"pause.xad.test", minutes:15 });
  if (!start?.ok || !start.paused || !start.until) throw new Error(`pause rejected: ${JSON.stringify(start)}`);

  const status = await send(popup, { type:"getTemporarySitePause", host:"pause.xad.test" });
  if (!status?.ok || !status.paused || status.minutesLeft < 1 || status.minutesLeft > 15) throw new Error(`pause state invalid: ${JSON.stringify(status)}`);

  const rules = await pauseRules(worker);
  const pauseRule = rules.find((r) => r.action?.type === "allowAllRequests" && r.condition?.requestDomains?.includes("pause.xad.test"));
  if (!pauseRule) throw new Error(`temporary DNR allow rule missing: ${JSON.stringify(rules)}`);

  const bridged = await worker.evaluate(async () => await chrome.storage.local.get({ allowSites:[], xadTemporaryPauseInjectedAllowSitesV1:[] }));
  if (!bridged.allowSites.includes("pause.xad.test") || !bridged.xadTemporaryPauseInjectedAllowSitesV1.includes("pause.xad.test")) {
    throw new Error(`temporary compatibility bridge missing: ${JSON.stringify(bridged)}`);
  }
  log("Pause active", JSON.stringify({ minutesLeft:status.minutesLeft, rules:rules.length }));

  const page = await browser.newPage();
  await page.goto(`http://pause.xad.test:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(900);
  const pausedView = await page.evaluate(() => ({
    normal:getComputedStyle(document.querySelector("#normal")).display,
    ad:getComputedStyle(document.querySelector("#ad")).display,
    hidden:document.querySelector("#ad")?.dataset?.xadkillerHidden || ""
  }));
  if (pausedView.normal === "none" || pausedView.ad === "none" || pausedView.hidden === "1") {
    throw new Error(`DOM protection did not pause cleanly: ${JSON.stringify(pausedView)}`);
  }
  log("DOM layers paused", JSON.stringify(pausedView));

  const stop = await send(popup, { type:"setTemporarySitePause", host:"pause.xad.test", minutes:0 });
  if (!stop?.ok || stop.paused) throw new Error(`resume rejected: ${JSON.stringify(stop)}`);
  await delay(400);
  if ((await pauseRules(worker)).some((r) => r.condition?.requestDomains?.includes("pause.xad.test"))) throw new Error("temporary DNR rule survived resume");

  const afterResume = await worker.evaluate(async () => await chrome.storage.local.get({ allowSites:[], xadTemporaryPauseInjectedAllowSitesV1:[] }));
  if (afterResume.allowSites.includes("pause.xad.test") || afterResume.xadTemporaryPauseInjectedAllowSitesV1.includes("pause.xad.test")) {
    throw new Error(`temporary allowlist bridge survived resume: ${JSON.stringify(afterResume)}`);
  }

  await page.reload({ waitUntil:"domcontentloaded", timeout:12000 });
  await delay(900);
  const protectedView = await page.evaluate(() => ({
    normal:getComputedStyle(document.querySelector("#normal")).display,
    ad:getComputedStyle(document.querySelector("#ad")).display
  }));
  if (protectedView.normal === "none" || protectedView.ad !== "none") throw new Error(`protection did not resume: ${JSON.stringify(protectedView)}`);
  log("Protection restored", JSON.stringify(protectedView));

  await worker.evaluate(async () => await chrome.storage.local.set({ allowSites:["permanent.example"] }));
  const persistentPause = await send(popup, { type:"setTemporarySitePause", host:"permanent.example", minutes:15 });
  if (!persistentPause?.ok) throw new Error(`persistent allow pause setup failed: ${JSON.stringify(persistentPause)}`);
  await send(popup, { type:"setTemporarySitePause", host:"permanent.example", minutes:0 });
  const preserved = await worker.evaluate(async () => await chrome.storage.local.get({ allowSites:[], xadTemporaryPauseInjectedAllowSitesV1:[] }));
  if (!preserved.allowSites.includes("permanent.example")) throw new Error(`permanent allowlist entry was removed: ${JSON.stringify(preserved)}`);
  if (preserved.xadTemporaryPauseInjectedAllowSitesV1.includes("permanent.example")) throw new Error(`pre-existing allowlist entry was incorrectly marked temporary: ${JSON.stringify(preserved)}`);
  log("Permanent allowlist preserved", JSON.stringify(preserved));

  log("PASS", "15-minute DNR pause, DOM pause, resume and permanent allowlist safety verified");
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
}
