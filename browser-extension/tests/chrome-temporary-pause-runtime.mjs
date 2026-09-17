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
<form id="login-form" class="account-login-panel"><label>Email <input id="login-email" value="user@example.test"></label><button type="button">Sign in</button></form>
<section id="checkout" class="checkout-summary payment-card"><strong>Order total</strong><button id="checkout-button" type="button">Pay now</button></section>
<section id="media-player" class="media-player"><video id="content-video" controls muted></video><button id="media-control" type="button" aria-label="Play video">Play</button></section>
<div id="address-form" class="address-card">Delivery address</div>
<div id="ad" class="adsbygoogle" style="width:300px;height:90px">ADVERTISEMENT</div>
<div id="open-host"></div><div id="closed-host"></div>
<script>
  const openRoot = document.querySelector('#open-host').attachShadow({mode:'open'});
  const openAd = document.createElement('div'); openAd.id='open-ad'; openAd.className='adsbygoogle'; openAd.textContent='OPEN SHADOW AD'; openRoot.appendChild(openAd);
  const closedRoot = document.querySelector('#closed-host').attachShadow({mode:'closed'});
  const closedAd = document.createElement('div'); closedAd.id='closed-ad'; closedAd.className='adsbygoogle'; closedAd.textContent='CLOSED SHADOW AD'; closedRoot.appendChild(closedAd); window.__pauseClosedAd=closedAd;
</script>
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

function assertBusinessUi(view, phase) {
  for (const key of ["login", "checkout", "media", "address"]) {
    if (view[key] === "none" || view[key] === "hidden" || view[key] === "missing") {
      throw new Error(`${phase}: normal ${key} UI was broken: ${JSON.stringify(view)}`);
    }
  }
  if (view.email !== "user@example.test") throw new Error(`${phase}: login field content changed: ${JSON.stringify(view)}`);
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
  const pausedView = await page.evaluate(() => {
    const openAd = document.querySelector('#open-host')?.shadowRoot?.querySelector('#open-ad');
    const closedAd = window.__pauseClosedAd;
    const state = (selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).display : "missing";
    };
    return {
      normal:state("#normal"),
      login:state("#login-form"),
      checkout:state("#checkout"),
      media:state("#media-player"),
      address:state("#address-form"),
      email:document.querySelector("#login-email")?.value || "",
      ad:state("#ad"),
      hidden:document.querySelector("#ad")?.dataset?.xadkillerHidden || "",
      shadowHidden:document.querySelector("#ad")?.dataset?.xadkillerShadowHidden || "",
      openShadow:openAd ? getComputedStyle(openAd).display : "missing",
      closedShadow:closedAd ? getComputedStyle(closedAd).display : "missing"
    };
  });
  assertBusinessUi(pausedView, "pause");
  if (pausedView.normal === "none" || pausedView.ad === "none" || pausedView.hidden === "1" || pausedView.shadowHidden === "1" || pausedView.openShadow === "none" || pausedView.closedShadow === "none") {
    throw new Error(`DOM protection did not pause cleanly: ${JSON.stringify(pausedView)}`);
  }
  log("DOM + Shadow + business UI layers paused cleanly", JSON.stringify(pausedView));

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
  const protectedView = await page.evaluate(() => {
    const openAd = document.querySelector('#open-host')?.shadowRoot?.querySelector('#open-ad');
    const closedAd = window.__pauseClosedAd;
    const state = (selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).display : "missing";
    };
    return {
      normal:state("#normal"),
      login:state("#login-form"),
      checkout:state("#checkout"),
      media:state("#media-player"),
      address:state("#address-form"),
      email:document.querySelector("#login-email")?.value || "",
      ad:state("#ad"),
      openShadow:openAd ? getComputedStyle(openAd).display : "missing",
      closedShadow:closedAd ? getComputedStyle(closedAd).display : "missing"
    };
  });
  assertBusinessUi(protectedView, "protected");
  if (protectedView.normal === "none" || protectedView.ad !== "none" || protectedView.openShadow !== "none" || protectedView.closedShadow !== "none") {
    throw new Error(`protection did not resume across DOM/Shadow layers: ${JSON.stringify(protectedView)}`);
  }
  log("Protection restored without login/checkout/media breakage", JSON.stringify(protectedView));

  await worker.evaluate(async () => await chrome.storage.local.set({ allowSites:["permanent.example"] }));
  const persistentPause = await send(popup, { type:"setTemporarySitePause", host:"permanent.example", minutes:15 });
  if (!persistentPause?.ok) throw new Error(`persistent allow pause setup failed: ${JSON.stringify(persistentPause)}`);
  await send(popup, { type:"setTemporarySitePause", host:"permanent.example", minutes:0 });
  const preserved = await worker.evaluate(async () => await chrome.storage.local.get({ allowSites:[], xadTemporaryPauseInjectedAllowSitesV1:[] }));
  if (!preserved.allowSites.includes("permanent.example")) throw new Error(`permanent allowlist entry was removed: ${JSON.stringify(preserved)}`);
  if (preserved.xadTemporaryPauseInjectedAllowSitesV1.includes("permanent.example")) throw new Error(`pre-existing allowlist entry was incorrectly marked temporary: ${JSON.stringify(preserved)}`);
  log("Permanent allowlist preserved", JSON.stringify(preserved));

  log("PASS", "15-minute DNR pause, login/checkout/media safety, normal/open/closed-shadow DOM pause, resume and permanent allowlist safety verified");
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
}
