import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const rulesDir = path.join(extensionPath, "rules");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller TITAN CI] ${stage}${extra ? ` • ${extra}` : ""}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const metaText = fs.readFileSync(path.join(extensionPath, "build-meta.js"), "utf8");
const metaMatch = metaText.match(/self\.XAD_BUILD_META=(\{.*\});/s);
if (!metaMatch) throw new Error("build-meta.js unreadable");
const meta = JSON.parse(metaMatch[1]);
const dynamicPack = readJson(path.join(rulesDir, "dynamic-intel.json"));
const titanSessionPack = readJson(path.join(rulesDir, "titan-session.json"));
if (dynamicPack.length < 18000 || titanSessionPack.length < 1200) {
  throw new Error(`packaged intelligence unexpectedly small dynamic=${dynamicPack.length} session=${titanSessionPack.length}`);
}
log("Build artifact meta OK", `v=${meta.version}, static=${meta.standardRules}+${meta.ultraRules}, dynamicPack=${dynamicPack.length}, sessionPack=${titanSessionPack.length}, cosmetic=${meta.cosmeticGeneric}/${meta.cosmeticDomains}`);

const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="normal-content">keep me</div>
  <div class="adsbygoogle">cosmetic ad</div>
  <div data-ad-unit="leaderboard">smart ad</div>
  <button id="skip-ad">Skip Ad</button>
  <div id="open-shadow-host"></div>
  <div id="closed-shadow-host"></div>
  <script>
    window.skipClicks=0;
    document.getElementById('skip-ad').addEventListener('click',()=>window.skipClicks++);
    const openHost=document.getElementById('open-shadow-host');
    const openRoot=openHost.attachShadow({mode:'open'});
    const openAd=document.createElement('div'); openAd.className='adsbygoogle'; openAd.textContent='shadow ad'; openRoot.appendChild(openAd);
    const closedHost=document.getElementById('closed-shadow-host');
    const closedRoot=closedHost.attachShadow({mode:'closed'});
    const closedAd=document.createElement('div'); closedAd.className='adsbygoogle'; closedAd.textContent='closed shadow ad'; closedRoot.appendChild(closedAd);
    setTimeout(()=>{ const d=document.createElement('div'); d.id='dynamic-ad'; d.className='adsbygoogle'; d.textContent='dynamic ad'; document.body.appendChild(d); },250);
  </script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
  res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
  res.end(fixtureHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
log("HTTP fixture ready", String(port));

async function findWorker(browser, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const probe = await worker.evaluate(() => ({ id:chrome.runtime.id, manifest:chrome.runtime.getManifest() }));
        if (probe?.manifest?.permissions?.includes("declarativeNetRequest")) return { worker, extensionId:probe.id };
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not found");
}

async function shieldStats(worker) {
  return await worker.evaluate(async () => {
    const [dynamic, session] = await Promise.all([
      new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules(resolve)),
      new Promise((resolve) => chrome.declarativeNetRequest.getSessionRules(resolve))
    ]);
    return {
      dynamicTotal:dynamic.length,
      intel:dynamic.filter((r)=>r.id>=100000&&r.id<=123999).length,
      core:dynamic.filter((r)=>r.id>=130000&&r.id<=130199).length,
      live:dynamic.filter((r)=>r.id>=140000&&r.id<=140899).length,
      matrix:dynamic.filter((r)=>r.id>=150000&&r.id<=150399).length,
      regex:dynamic.filter((r)=>r.id>=160000&&r.id<=160199).length,
      custom:dynamic.filter((r)=>r.id>=910000&&r.id<=914999).length,
      session:session.filter((r)=>r.id>=200000&&r.id<=204499).length,
      learned:session.filter((r)=>r.id>=290000&&r.id<=290299).length,
      sessionTotal:session.length
    };
  });
}

async function waitShield(worker, expected, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await shieldStats(worker);
    let ok = true;
    for (const [key, minimum] of Object.entries(expected)) {
      if ((last[key] || 0) < minimum) { ok = false; break; }
    }
    if (ok) return last;
    await delay(250);
  }
  throw new Error(`shield state timeout expected=${JSON.stringify(expected)} last=${JSON.stringify(last)}`);
}

async function waitForAlarms(worker, requiredNames, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastNames = [];
  while (Date.now() < deadline) {
    const alarms = await worker.evaluate(async () => await chrome.alarms.getAll());
    lastNames = alarms.map((a) => a.name).sort();
    if (requiredNames.every((name) => lastNames.includes(name))) return lastNames;
    await delay(150);
  }
  const missing = requiredNames.filter((name) => !lastNames.includes(name));
  throw new Error(`missing update alarms ${missing.join(",")}: ${lastNames.join(",")}`);
}

async function sendFromPage(page, message) {
  return await page.evaluate(async (payload) => await chrome.runtime.sendMessage(payload), message);
}

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath:chromium.executablePath(),
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],
    timeout:60000
  });
  log("Chrome launched");
  const { worker, extensionId } = await findWorker(browser);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  log("TITAN worker ready", `${manifest.version} • chrome-extension://${extensionId}/service-worker.js`);

  const requiredAlarms = ["xadkiller-live-matrix-refresh","xadkiller-titan-refresh","xadkiller-live-shield-refresh"];
  const alarmNames = await waitForAlarms(worker, requiredAlarms);
  log("Update alarms OK", alarmNames.join(","));

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.waitForSelector("#mode", { timeout:12000 });

  const standardSessionFloor = Math.min(2700, titanSessionPack.length);
  const ultraSessionFloor = Math.min(2850, titanSessionPack.length);
  const standardShield = await waitShield(worker, { intel:15000, live:60, core:15, matrix:15, regex:2, session:standardSessionFloor }, 50000);
  log("STANDARD TITAN Shield", JSON.stringify(standardShield));

  const titanStats = await sendFromPage(popup, { type:"getTitanStats" });
  if (!titanStats?.ok || titanStats.regex < 2) throw new Error(`TITAN feed stats invalid: ${JSON.stringify(titanStats)}`);
  log("TITAN feed", `${titanStats.version} • regex=${titanStats.regex}`);

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:"domcontentloaded", timeout:12000 });
  await delay(1500);
  const dom = await page.evaluate(() => ({
    normalVisible:!!document.getElementById("normal-content"),
    cosmeticVisible:!!document.querySelector(".adsbygoogle"),
    smartVisible:!!document.querySelector("[data-ad-unit]"),
    shadowVisible:!!document.getElementById("open-shadow-host")?.shadowRoot?.querySelector(".adsbygoogle"),
    closedShadowVisible:document.getElementById("closed-shadow-host")?.innerText?.includes("closed shadow ad") || false,
    dynamicTextVisible:document.body.innerText.includes("dynamic ad"),
    skipClicks:window.skipClicks
  }));
  if (!dom.normalVisible || dom.cosmeticVisible || dom.smartVisible || dom.shadowVisible || dom.closedShadowVisible || dom.dynamicTextVisible || dom.skipClicks < 1) {
    throw new Error(`DOM protection assertions failed: ${JSON.stringify(dom)}`);
  }
  log("DOM assertions", JSON.stringify(dom));

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

  const learnResult = await sendFromPage(popup, { type:"titanLearnResource", url:"https://ib.adnxs.com/runtime/ad.js", pageHost:"example.org" });
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
