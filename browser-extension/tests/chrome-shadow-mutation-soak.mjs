import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller SHADOW SOAK] ${stage}${extra ? ` • ${extra}` : ""}`);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shadow soak</title></head><body>
<div id="normal">NORMAL CONTENT</div><div id="open-host"></div><div id="closed-host"></div>
<script>
  window.__closedAds=[];
  window.__ticks=0;
  setInterval(()=>window.__ticks++,25);
  const openRoot=document.querySelector('#open-host').attachShadow({mode:'open'});
  const closedRoot=document.querySelector('#closed-host').attachShadow({mode:'closed'});
  window.__runSoak=async function() {
    const start=performance.now();
    for(let batch=0;batch<20;batch++) {
      const openFrag=document.createDocumentFragment();
      const closedFrag=document.createDocumentFragment();
      for(let i=0;i<25;i++) {
        const normal=document.createElement('span'); normal.className='content-item'; normal.textContent='content '+batch+' '+i; openFrag.appendChild(normal);
        const ad=document.createElement('div'); ad.className='adsbygoogle'; ad.textContent='ad '+batch+' '+i; openFrag.appendChild(ad);
        const closedNormal=document.createElement('span'); closedNormal.textContent='closed content '+batch+' '+i; closedFrag.appendChild(closedNormal);
        const closedAd=document.createElement('div'); closedAd.className='adsbygoogle'; closedAd.textContent='closed ad '+batch+' '+i; closedFrag.appendChild(closedAd); window.__closedAds.push(closedAd);
      }
      openRoot.appendChild(openFrag); closedRoot.appendChild(closedFrag);
      await new Promise((resolve)=>setTimeout(resolve,0));
    }
    return {elapsed:performance.now()-start,openAds:openRoot.querySelectorAll('.adsbygoogle').length,closedAds:window.__closedAds.length};
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function findExtension(browser, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name?.includes("xADKiller")) return worker;
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not found");
}

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath:chromium.executablePath(),
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP shadow.xad.test 127.0.0.1"],
    timeout:60000
  });
  await findExtension(browser);
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(`http://shadow.xad.test:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(400);

  const ticksBefore = await page.evaluate(() => window.__ticks);
  const run = await page.evaluate(async () => await window.__runSoak());
  await delay(900);
  const state = await page.evaluate(() => {
    const openRoot = document.querySelector('#open-host').shadowRoot;
    const openAds = [...openRoot.querySelectorAll('.adsbygoogle')];
    const normal = [...openRoot.querySelectorAll('.content-item')];
    return {
      ticks:window.__ticks,
      openAds:openAds.length,
      openHidden:openAds.filter((el)=>getComputedStyle(el).display==='none' || getComputedStyle(el).visibility==='hidden').length,
      closedAds:window.__closedAds.length,
      closedHidden:window.__closedAds.filter((el)=>getComputedStyle(el).display==='none' || getComputedStyle(el).visibility==='hidden').length,
      normal:normal.length,
      normalVisible:normal.filter((el)=>getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden').length,
      topNormal:getComputedStyle(document.querySelector('#normal')).display
    };
  });

  if (run.openAds !== 500 || run.closedAds !== 500) throw new Error(`fixture insertion incomplete: ${JSON.stringify(run)}`);
  if (run.elapsed > 7000) throw new Error(`mutation insertion too slow: ${run.elapsed.toFixed(1)}ms`);
  if (state.ticks <= ticksBefore + 5) throw new Error(`renderer heartbeat stalled: before=${ticksBefore}, after=${state.ticks}`);
  if (state.openHidden !== state.openAds || state.closedHidden !== state.closedAds) throw new Error(`shadow ads escaped protection: ${JSON.stringify(state)}`);
  if (state.normalVisible !== state.normal || state.topNormal === "none") throw new Error(`normal content was damaged: ${JSON.stringify(state)}`);

  log("PASS", `1000 shadow mutations + 1000 content nodes processed; open=${state.openHidden}/${state.openAds}, closed=${state.closedHidden}/${state.closedAds}, heartbeat=${state.ticks - ticksBefore}, insert=${run.elapsed.toFixed(1)}ms`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
}
