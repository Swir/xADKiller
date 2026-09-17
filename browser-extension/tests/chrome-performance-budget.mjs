import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller PERF CI] ${stage}${extra ? ` • ${extra}` : ""}`);

// These are intentionally generous regression ceilings, not marketing claims.
// The goal is to catch pathological startup/DOM/heap regressions in CI while
// leaving room for normal GitHub-hosted runner variance.
const BUDGET = Object.freeze({
  workerReadyMs:20_000,
  fixtureInjectMs:2_500,
  protectionSettleMs:3_500,
  heapDeltaBytes:72 * 1024 * 1024,
  finalHeapBytes:140 * 1024 * 1024
});

const html = `<!doctype html><html><head><meta charset="utf-8"><title>xADKiller performance fixture</title>
<style>body{font-family:system-ui}.normal-card{min-height:2px}.adsbygoogle{width:300px;height:36px}</style></head><body>
<main id="root"><h1 id="title">Performance fixture</h1><div id="feed"></div></main>
<script>
window.__heartbeat=0;setInterval(()=>window.__heartbeat++,20);
window.injectLoad=async()=>{
  const feed=document.getElementById('feed');
  const started=performance.now();
  for(let burst=0;burst<10;burst++){
    const f=document.createDocumentFragment();
    for(let i=0;i<60;i++){
      const n=document.createElement('article');n.className='normal-card';n.textContent='Content '+burst+'-'+i;f.appendChild(n);
      if(i%2===0){const ad=document.createElement('div');ad.className='adsbygoogle';ad.textContent='ADVERTISEMENT';f.appendChild(ad);}
    }
    feed.appendChild(f);
    await new Promise(r=>setTimeout(r,4));
  }
  window.__injectMs=performance.now()-started;
  return { normal:document.querySelectorAll('.normal-card').length, ads:document.querySelectorAll('.adsbygoogle').length, injectMs:window.__injectMs };
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type":"text/html; charset=utf-8", "cache-control":"no-store" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function findWorker(browser, timeoutMs = 25_000) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.permissions?.includes("declarativeNetRequest") && manifest?.action?.default_popup === "popup.html") {
          return {
            worker,
            extensionId:await worker.evaluate(() => chrome.runtime.id),
            version:String(manifest.version || ""),
            readyMs:Date.now() - started
          };
        }
      } catch (_) {}
    }
    await delay(150);
  }
  throw new Error(`xADKiller worker did not become ready within ${timeoutMs}ms`);
}

async function pageState(page) {
  return await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const s=getComputedStyle(el);
      return s.display!=="none" && s.visibility!=="hidden" && Number(s.opacity||1)>0;
    };
    const normals=[...document.querySelectorAll('.normal-card')];
    const ads=[...document.querySelectorAll('.adsbygoogle')];
    return {
      heartbeat:window.__heartbeat||0,
      normal:normals.length,
      normalVisible:normals.filter(visible).length,
      ads:ads.length,
      adsHidden:ads.filter((el)=>!visible(el)).length,
      titleVisible:visible(document.querySelector('#title'))
    };
  });
}

let browser = null;
try {
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error(`Chromium executable missing: ${executablePath}`);

  browser = await puppeteer.launch({
    executablePath,
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP perf.xad.test 127.0.0.1"],
    timeout:60_000
  });

  const ready = await findWorker(browser);
  if (ready.readyMs > BUDGET.workerReadyMs) throw new Error(`worker startup budget exceeded: ${ready.readyMs}ms > ${BUDGET.workerReadyMs}ms`);
  log("Worker ready", `v=${ready.version} • ${ready.readyMs}ms`);

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${ready.extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12_000 });
  await delay(200);
  await popup.close();

  const page = await browser.newPage();
  page.setDefaultTimeout(12_000);
  await page.goto(`http://perf.xad.test:${port}/`, { waitUntil:"domcontentloaded", timeout:12_000 });
  await delay(350);

  const beforeMetrics = await page.metrics();
  const heartbeatBefore = await page.evaluate(() => window.__heartbeat||0);
  const injected = await page.evaluate(async () => await window.injectLoad());
  if (injected.normal !== 600 || injected.ads !== 300) throw new Error(`fixture count mismatch: ${JSON.stringify(injected)}`);
  if (!(injected.injectMs >= 0 && injected.injectMs <= BUDGET.fixtureInjectMs)) {
    throw new Error(`fixture injection budget exceeded: ${injected.injectMs}ms > ${BUDGET.fixtureInjectMs}ms`);
  }

  const settleStarted = Date.now();
  let state = null;
  while (Date.now() - settleStarted < BUDGET.protectionSettleMs) {
    state = await pageState(page);
    if (state.adsHidden === 300) break;
    await delay(50);
  }
  const settleMs = Date.now() - settleStarted;
  state = await pageState(page);
  const afterMetrics = await page.metrics();

  if (state.normal !== 600 || state.normalVisible !== 600 || !state.titleVisible) throw new Error(`normal content damaged: ${JSON.stringify(state)}`);
  if (state.ads !== 300 || state.adsHidden !== 300) throw new Error(`ad protection incomplete: ${JSON.stringify(state)}`);
  if (settleMs > BUDGET.protectionSettleMs) throw new Error(`DOM settle budget exceeded: ${settleMs}ms > ${BUDGET.protectionSettleMs}ms`);
  if (state.heartbeat <= heartbeatBefore + 4) throw new Error(`renderer heartbeat stalled: ${heartbeatBefore} -> ${state.heartbeat}`);

  const beforeHeap = Number(beforeMetrics.JSHeapUsedSize || 0);
  const finalHeap = Number(afterMetrics.JSHeapUsedSize || 0);
  const heapDelta = Math.max(0, finalHeap - beforeHeap);
  if (heapDelta > BUDGET.heapDeltaBytes) throw new Error(`heap delta budget exceeded: ${heapDelta} > ${BUDGET.heapDeltaBytes}`);
  if (finalHeap > BUDGET.finalHeapBytes) throw new Error(`final heap budget exceeded: ${finalHeap} > ${BUDGET.finalHeapBytes}`);

  log("PASS", `worker=${ready.readyMs}ms • inject=${injected.injectMs.toFixed(1)}ms • settle=${settleMs}ms • heapDelta=${Math.round(heapDelta/1024/1024)}MiB • finalHeap=${Math.round(finalHeap/1024/1024)}MiB • 300/300 ads hidden • 600/600 normal nodes preserved`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
}
