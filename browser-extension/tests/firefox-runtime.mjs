import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";

const root = path.resolve(import.meta.dirname, "..");
const resultDir = path.join(root, "test-results", "firefox");
fs.mkdirSync(resultDir, { recursive: true });
const testExtension = fs.mkdtempSync(path.join(resultDir, "extension-"));
fs.cpSync(path.join(root, "dist", "firefox"), testExtension, { recursive: true });
const manifestPath = path.join(testExtension, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath));
manifest.permissions.push("declarativeNetRequestFeedback");
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [] };
function passed(name, value = true) { report.checks.push({ name, value }); console.log(`PASS ${name}: ${JSON.stringify(value)}`); }
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) { last = await fn(); if (last) return last; await delay(200); }
  throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}`);
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>xADKiller Firefox fixture</title></head><body>
<h1 id="normal-content">Normal article</h1><input id="login" placeholder="Username"><button id="normal-button">Continue</button>
<div class="adsbygoogle" id="advert">Advertisement</div><div id="open-shadow"></div><div id="closed-shadow"></div>
<script>
window.skipped=0;
for(const kind of ['open','closed']) { const r=document.getElementById(kind+'-shadow').attachShadow({mode:kind});const d=document.createElement('div');d.className='adsbygoogle';d.textContent='Advertisement';r.appendChild(d);window[kind+'Ad']=d; }
</script></body></html>`;
const hits = [];
const token = randomUUID();
const pending = new Map();
const commands = [];
let waitingClient;
let commandId = 0;
function command(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Test driver timeout: ${name}`)); }, 45000);
    pending.set(id, {resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    const data = JSON.stringify({id,name,args});
    if (waitingClient) { const response=waitingClient; waitingClient=null; response.end(data); }
    else commands.push(data);
  });
}
const server = http.createServer(async (req, res) => {
  if (req.url === `/__test/${token}/command`) {
    res.setHeader("Content-Type","application/json");
    if (commands.length) res.end(commands.shift()); else waitingClient=res;
    return;
  }
  if (req.url === `/__test/${token}/result` && req.method === "POST") {
    let body=""; for await (const chunk of req) body+=chunk;
    const result=JSON.parse(body); const entry=pending.get(result.id); pending.delete(result.id);
    if(entry) { if(result.error) entry.reject(new Error(result.error)); else entry.resolve(result.value); }
    res.end("ok"); return;
  }
  hits.push(req.url);
  if (req.url.startsWith("/ads/") || req.url.startsWith("/api/")) { res.writeHead(200, {"Content-Type":"text/plain"}); return res.end("ok"); }
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"}); res.end(fixture);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Firefox 156+ excludes extension pages from normal WebDriver contexts.
// A packaged, test-only driver operates the popup through a fixed loopback command
// set, keeping Firefox's system-access security restriction enabled.
manifest.background.scripts.unshift("test-open-popup.js");
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
fs.writeFileSync(path.join(testExtension,"test-open-popup.js"), 'browser.tabs.create({url:browser.runtime.getURL("popup.html")});\n');
fs.writeFileSync(path.join(testExtension,"test-endpoint.js"), `globalThis.XAD_TEST_ENDPOINT=${JSON.stringify(origin+"/__test/"+token)};\n`);
fs.copyFileSync(path.join(root,"tests","firefox-test-driver.js"),path.join(testExtension,"firefox-test-driver.js"));
const popupHtml=path.join(testExtension,"popup.html");
fs.writeFileSync(popupHtml,fs.readFileSync(popupHtml,"utf8").replace("</body>",'<script src="test-endpoint.js"></script><script src="firefox-test-driver.js"></script></body>'));
let browser;
try {
  browser = await puppeteer.launch({
    browser: "firefox", protocol: "webDriverBiDi", headless: true,
    userDataDir: fs.mkdtempSync(path.join(resultDir,"profile-")),
    executablePath: process.env.FIREFOX_BIN || (process.platform === "win32" ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe" : "firefox"),
    extraPrefsFirefox: { "extensions.dnr.feedback": true }
  });
  report.browser = await browser.version();
  assert.equal(await browser.installExtension(testExtension), manifest.browser_specific_settings.gecko.id);
  const errors = [];
  const send = message => command("send", message);
  const rules = () => command("rules");
  await until(async () => { const r = await rules(); return r.dynamic.some(x => x.id >= 100000 && x.id <= 123999) && r.session.length > 0; }, "background protection ready");
  const state = await send({type:"getState"});
  assert.equal(state.build.browser, "firefox");
  assert.equal(state.build.version, manifest.version);
  passed("background starts and reports Firefox build", state.build.version);
  const initial = await rules();
  assert(initial.dynamic.length <= 5000 && initial.session.length <= 5000);
  assert.equal(initial.dynamic.filter(r=>r.id>=100000&&r.id<=123999).flatMap(r=>r.condition.requestDomains).length,16000);
  passed("STANDARD domain coverage and quotas", { dynamic:initial.dynamic.length, session:initial.session.length });

  const corpus = fs.readFileSync(path.join(root, "tests", "chrome-blocking-benchmark.mjs"), "utf8");
  const parseCases = name => JSON.parse(corpus.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]);
  const adCases = parseCases("AD_CASES");
  const benignCases = parseCases("BENIGN_CASES");
  async function benchmark(mode) {
    const response = await send({type:"setMode",mode}); assert(response.ok, JSON.stringify(response));
    await until(async()=>{const r=await rules();return mode==='ultra'?r.enabled.includes('ultra'):!r.enabled.includes('ultra');}, "mode applied");
    const result = await command("benchmark", {ads:adCases,benign:benignCases});
    assert(result.ads.every(Boolean),`${mode} missed: ${JSON.stringify(adCases.filter((_,i)=>!result.ads[i]))}`);
    assert(!result.benign.some(Boolean),`${mode} false positives`);
    passed(`${mode} DNR benchmark`, {blocked:result.ads.length,benign:result.benign.length});
  }
  await benchmark("standard");
  await benchmark("ultra");
  const ultra = await rules();
  assert.equal(ultra.dynamic.filter(r=>r.id>=100000&&r.id<=123999).flatMap(r=>r.condition.requestDomains).length,24000);
  assert(ultra.dynamic.length <= 5000 && ultra.session.length <= 5000);
  passed("ULTRA preserves 24,000 intelligence domains", ultra.dynamic.length);
  await benchmark("standard");
  await until(async()=> (await rules()).enabled.includes("titan_boost_1"),"optional boost restored after mode transition");
  passed("ULTRA to STANDARD restores optional static boost");

  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const hidden = () => page.evaluate(()=>({
    ad:getComputedStyle(document.querySelector('#advert')).display==='none',
    open:getComputedStyle(window.openAd).display==='none',
    closed:getComputedStyle(window.closedAd).display==='none',
    normal:getComputedStyle(document.querySelector('#normal-content')).display!=='none'
  }));
  await page.goto(origin);
  await until(async()=>{const x=await hidden();return x.ad&&x.open&&x.closed&&x.normal;},"cosmetic and shadow protection");
  passed("cosmetic, open/closed Shadow DOM and normal content");
  const fetchAd = () => page.evaluate(async()=>{try{return (await fetch('/ads/banner.js')).ok;}catch{return false;}});
  assert.equal(await fetchAd(),false);
  passed("real advertising request blocked");
  assert((await send({type:"setHeuristicSiteRecovery",host:"127.0.0.1",minutes:15})).ok);
  await until(async()=>{const x=await hidden();return !x.ad&&!x.open&&!x.closed;},"safe recovery restores cosmetic layers");
  assert((await rules()).enabled.includes("standard"));
  assert.equal(await fetchAd(),false);
  assert((await send({type:"setHeuristicSiteRecovery",host:"127.0.0.1",minutes:0})).ok);
  passed("safe recovery keeps network filtering active");
  assert((await send({type:"setEnabled",enabled:false})).ok);
  await until(async()=>{const x=await hidden();return !x.ad&&!x.open&&!x.closed&&x.normal;},"disabled restores page and crosses Firefox realms");
  assert.equal(await fetchAd(),true);
  const disabled = await rules();
  assert(!disabled.dynamic.some(r=>r.action.type==='block'));
  assert.equal(disabled.session.length,0);
  passed("disable restores all layers and allows real request");
  assert((await send({type:"setEnabled",enabled:true})).ok);
  await until(async()=>{const x=await hidden();return x.ad&&x.closed;},"reenabled");
  assert((await send({type:"setSiteAllowed",host:"127.0.0.1",allowed:true})).ok);
  await page.reload();
  await until(async()=>{const x=await hidden();return !x.ad&&!x.closed;},"allowlisted site restored");
  assert.equal(await fetchAd(),true);
  passed("site allowlist restores network and page protection");
  assert((await send({type:"setSiteAllowed",host:"127.0.0.1",allowed:false})).ok);
  await page.reload();
  await until(async()=>{const x=await hidden();return x.ad&&x.closed;},"allowlist removed");
  assert((await send({type:"setTemporarySitePause",host:"127.0.0.1",minutes:15})).ok);
  await page.reload();
  await until(async()=>{const x=await hidden();return !x.ad&&!x.closed;},"temporary pause");
  assert.equal(await fetchAd(),true);
  assert((await send({type:"setTemporarySitePause",host:"127.0.0.1",minutes:0})).ok);
  passed("temporary site pause and resume");
  assert((await send({type:"addCustomDomain",host:"custom-ad.example"})).ok);
  assert((await rules()).dynamic.some(r=>r.condition.requestDomains?.includes('custom-ad.example')));
  assert((await send({type:"removeCustomDomain",host:"custom-ad.example"})).ok);
  assert(!(await rules()).dynamic.some(r=>r.condition.requestDomains?.includes('custom-ad.example')));
  passed("custom domain add/remove");
  assert((await send({type:"setMode",mode:"ultra"})).ok);
  await until(async()=> (await rules()).enabled.includes("ultra"),"ULTRA learning mode");
  const learn={type:"titanLearnResource",url:"https://test.doubleclick.net/adrequest?private=not-stored",pageHost:"publisher.example"};
  assert((await send(learn)).ok); assert((await send(learn)).ok);
  const memory=await send({type:"getTitanStats"});
  assert(memory.ok && memory.memory>0 && memory.promoted>0);
  const ignored=await send({type:"titanLearnResource",url:"https://publisher.example/article?campaign=normal",pageHost:"publisher.example"});
  assert.equal(ignored.ignored,true);
  assert((await send({type:"resetTitanMemory"})).ok);
  assert.equal((await send({type:"getTitanStats"})).memory,0);
  passed("adaptive memory promotion, benign-query rejection and reset");
  assert.deepEqual(await command("language","pl"), {selected:"pl",saved:"pl"});
  assert.deepEqual(await command("language","en"), {selected:"en",saved:"en"});
  passed("Polish and English UI selection and storage");
  assert.deepEqual(errors,[],"extension/page JavaScript errors");
  passed("no page JavaScript errors");
  report.ok = true;
} catch(error) {
  report.ok = false; report.error = String(error.stack || error); throw error;
} finally {
  fs.writeFileSync(path.join(resultDir,"runtime-report.json"),JSON.stringify(report,null,2));
  if(browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
