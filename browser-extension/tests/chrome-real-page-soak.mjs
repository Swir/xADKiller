import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller REAL PAGE CI] ${stage}${extra ? ` • ${extra}` : ""}`);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>xADKiller real-page fixture</title>
<style>
body{font-family:system-ui;margin:0}header,nav,main,footer{padding:12px}.product-card{padding:4px}.shell{display:grid;grid-template-columns:2fr 1fr;gap:12px}.adsbygoogle{width:300px;height:40px}.shadow-host{min-height:1px}
</style></head><body>
<header id="site-header"><strong>Example Store</strong><button id="account-button">Account</button></header>
<nav id="site-nav"><a href="#catalog">Catalog</a><a href="#orders">Orders</a></nav>
<main class="shell">
<section id="catalog"><h1>Catalog</h1><div id="feed"></div></section>
<aside id="account-panel">
<form id="login-form"><label>Email <input id="email" value="customer@example.test"></label><button id="login-button" type="button">Sign in</button></form>
<section id="checkout"><strong id="total">Total: 42.00</strong><button id="pay-button" type="button">Pay now</button></section>
<section id="media"><video id="video" controls muted></video><button id="play-button" type="button">Play</button></section>
<div id="open-shadows"></div><div id="closed-shadows"></div>
</aside>
</main>
<footer id="site-footer">Support · Privacy · Terms</footer>
<script>
window.__closedAds=[];
window.__heartbeat=0;
setInterval(()=>window.__heartbeat++,25);
window.__businessClicks=0;
for(const id of ['account-button','login-button','pay-button','play-button']) document.getElementById(id).addEventListener('click',()=>window.__businessClicks++);
window.injectFixture=async function(){
  const feed=document.getElementById('feed');
  const openHolder=document.getElementById('open-shadows');
  const closedHolder=document.getElementById('closed-shadows');
  const started=performance.now();
  let normal=0,ads=0;
  for(let burst=0;burst<8;burst++){
    const fragment=document.createDocumentFragment();
    for(let i=0;i<20;i++){
      const card=document.createElement('article'); card.className='product-card'; card.dataset.row=String(normal); card.textContent='Product '+normal; fragment.appendChild(card); normal++;
      const ad=document.createElement('div'); ad.className='adsbygoogle'; ad.dataset.adIndex=String(ads); ad.textContent='ADVERTISEMENT '+ads; fragment.appendChild(ad); ads++;
    }
    feed.appendChild(fragment);
    await new Promise(r=>setTimeout(r,8));
  }
  for(let i=0;i<40;i++){
    const host=document.createElement('div'); host.className='shadow-host'; openHolder.appendChild(host);
    const sr=host.attachShadow({mode:'open'}); const ad=document.createElement('div'); ad.className='adsbygoogle'; ad.textContent='OPEN SHADOW AD '+i; sr.appendChild(ad);
  }
  for(let i=0;i<40;i++){
    const host=document.createElement('div'); host.className='shadow-host'; closedHolder.appendChild(host);
    const sr=host.attachShadow({mode:'closed'}); const ad=document.createElement('div'); ad.className='adsbygoogle'; ad.textContent='CLOSED SHADOW AD '+i; sr.appendChild(ad); window.__closedAds.push(ad);
  }
  window.__injectMs=performance.now()-started;
  return {normal,ads,injectMs:window.__injectMs};
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type":"text/html; charset=utf-8", "cache-control":"no-store" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function findWorker(browser, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name?.includes("xADKiller") && manifest?.permissions?.includes("declarativeNetRequest")) {
          return {
            worker,
            extensionId:await worker.evaluate(() => chrome.runtime.id),
            version:String(manifest.version || "")
          };
        }
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not ready");
}

async function snapshot(page) {
  return await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const s=getComputedStyle(el); return s.display!=="none" && s.visibility!=="hidden" && Number(s.opacity||1)>0;
    };
    const normals=[...document.querySelectorAll('.product-card')];
    const ads=[...document.querySelectorAll('#feed .adsbygoogle')];
    const openAds=[];
    document.querySelectorAll('#open-shadows .shadow-host').forEach((host)=>{const ad=host.shadowRoot?.querySelector('.adsbygoogle'); if(ad) openAds.push(ad);});
    const closedAds=window.__closedAds||[];
    return {
      heartbeat:window.__heartbeat||0,
      businessClicks:window.__businessClicks||0,
      email:document.querySelector('#email')?.value||'',
      injectMs:Number(window.__injectMs||0),
      normalCount:normals.length,
      normalVisible:normals.filter(visible).length,
      adCount:ads.length,
      adHidden:ads.filter((el)=>!visible(el)).length,
      openCount:openAds.length,
      openHidden:openAds.filter((el)=>!visible(el)).length,
      closedCount:closedAds.length,
      closedHidden:closedAds.filter((el)=>!visible(el)).length,
      businessVisible:['#site-header','#site-nav','#login-form','#checkout','#media','#site-footer'].every((sel)=>visible(document.querySelector(sel)))
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
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP realpage.xad.test 127.0.0.1"],
    timeout:60000
  });

  const ready = await findWorker(browser);
  log("Extension ready", `v=${ready.version} • id=${ready.extensionId}`);
  // Open the packaged popup once to force preference/service-worker hydration
  // before navigating the first real-page fixture. Without this readiness gate,
  // Chrome can race the first tab against extension registration in headless CI.
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${ready.extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(250);
  await popup.close();

  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(`http://realpage.xad.test:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(450);
  const heartbeatBefore = await page.evaluate(() => window.__heartbeat||0);
  const injected = await page.evaluate(async () => await window.injectFixture());
  log("Fixture injected", JSON.stringify(injected));
  if (injected.normal !== 160 || injected.ads !== 160) throw new Error(`fixture count mismatch: ${JSON.stringify(injected)}`);
  if (!(injected.injectMs >= 0 && injected.injectMs < 5000)) throw new Error(`fixture injection took unexpectedly long: ${injected.injectMs}ms`);

  const settleStarted = Date.now();
  let view = null;
  while (Date.now() - settleStarted < 6000) {
    view = await snapshot(page);
    if (view.adHidden === 160 && view.openHidden === 40 && view.closedHidden === 40) break;
    await delay(75);
  }
  const settleMs = Date.now() - settleStarted;
  view = await snapshot(page);
  log("Protected page", JSON.stringify({ ...view, settleMs }));

  if (view.normalCount !== 160 || view.normalVisible !== 160) throw new Error(`normal feed damaged: ${JSON.stringify(view)}`);
  if (!view.businessVisible || view.email !== "customer@example.test") throw new Error(`business UI damaged: ${JSON.stringify(view)}`);
  if (view.adCount !== 160 || view.adHidden !== 160 || view.openCount !== 40 || view.openHidden !== 40 || view.closedCount !== 40 || view.closedHidden !== 40) {
    throw new Error(`one or more ad layers remained visible: ${JSON.stringify(view)}`);
  }
  if (settleMs >= 6000) throw new Error(`ad mutations did not settle within regression budget: ${settleMs}ms`);

  await page.click('#account-button');
  await page.click('#login-button');
  await page.click('#pay-button');
  await page.click('#play-button');
  await delay(100);
  const afterClicks = await snapshot(page);
  if (afterClicks.businessClicks !== 4) throw new Error(`business controls stopped responding: ${JSON.stringify(afterClicks)}`);
  if (afterClicks.heartbeat <= heartbeatBefore + 5) throw new Error(`renderer heartbeat stalled: before=${heartbeatBefore} after=${afterClicks.heartbeat}`);

  log("PASS", `160/160 normal cards preserved • 160/160 normal-DOM ads hidden • 40/40 open-shadow ads hidden • 40/40 closed-shadow ads hidden • business controls responsive • settle=${settleMs}ms`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
  await new Promise((resolve) => server.close(resolve));
}
