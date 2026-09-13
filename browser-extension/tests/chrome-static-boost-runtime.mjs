import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root,"dist","chrome");
const meta = JSON.parse(fs.readFileSync(path.join(extensionPath,"titan-boost-meta.json"),"utf8"));
const buildText = fs.readFileSync(path.join(extensionPath,"build-meta.js"),"utf8");
const buildMatch = buildText.match(/XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;?$/);
const buildMeta = buildMatch ? JSON.parse(buildMatch[1]) : {};
const ids = ["titan_boost_1","titan_boost_2","titan_boost_3"];
const delay = (ms) => new Promise((r) => setTimeout(r,ms));
function log(msg,extra=""){console.log(`[xADKiller BOOST CI] ${msg}${extra?` • ${extra}`:""}`);}

async function workerFor(browser,timeout=20000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    for(const target of browser.targets()){
      if(target.type()!=="service_worker"||!target.url().startsWith("chrome-extension://"))continue;
      const w=await target.worker();if(!w)continue;
      try{
        const m=await w.evaluate(()=>chrome.runtime.getManifest());
        if(m.version==="1.4.0"&&m.name.includes("xADKiller"))return w;
      }catch(_){}
    }
    await delay(200);
  }
  throw new Error("xADKiller boost worker not found");
}
async function snapshot(worker){
  return await worker.evaluate(async()=>({
    enabled:await chrome.declarativeNetRequest.getEnabledRulesets(),
    available:await chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
    prefs:await chrome.storage.local.get({mode:"standard",enabled:true})
  }));
}
async function waitState(worker,{minBoost=0,requireUltra=false},timeout=18000){
  const deadline=Date.now()+timeout;let last;
  while(Date.now()<deadline){
    last=await snapshot(worker);
    const active=last.enabled.filter((x)=>x.startsWith("titan_boost_"));
    if(active.length>=minBoost&&(!requireUltra||last.enabled.includes("ultra")))return {...last,active};
    await delay(250);
  }
  throw new Error(`boost activation timeout: ${JSON.stringify(last)}`);
}
async function setModeThroughRuntime(worker,mode){
  return await worker.evaluate(async(m)=>await new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage({type:"setMode",mode:m},(response)=>{
      if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));
      else resolve(response||{});
    });
  }),mode);
}

if(!Array.isArray(meta.counts)||meta.counts.length!==3||meta.total<15000)throw new Error(`invalid boost meta ${JSON.stringify(meta)}`);
if(Number(buildMeta.ultraRules||0)<7000)throw new Error(`invalid core ULTRA meta ${JSON.stringify(buildMeta)}`);
let browser;
try{
  browser=await puppeteer.launch({
    executablePath:chromium.executablePath(),headless:true,pipe:true,enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],timeout:60000
  });
  const worker=await workerFor(browser);
  const initialFree=await worker.evaluate(async()=>await chrome.declarativeNetRequest.getAvailableStaticRuleCount());
  log("Initial available static quota",String(initialFree));
  const expectedStandard=initialFree>=Number(meta.counts[0]||0)?1:0;
  const standard=expectedStandard?await waitState(worker,{minBoost:1},18000):await snapshot(worker);
  const standardActive=standard.enabled.filter((x)=>ids.includes(x));
  if(standardActive.length!==expectedStandard)throw new Error(`STANDARD adaptive boost mismatch: expected=${expectedStandard}, state=${JSON.stringify(standard)}`);
  if(!standard.enabled.includes("standard"))throw new Error(`STANDARD core ruleset missing: ${standard.enabled.join(",")}`);
  log("STANDARD adaptive boost",JSON.stringify({active:standardActive,available:standard.available}));

  const modeResult=await setModeThroughRuntime(worker,"ultra");
  if(modeResult?.ok===false)throw new Error(`real setMode path failed: ${JSON.stringify(modeResult)}`);

  const coreReserve=Number(buildMeta.ultraRules||10000);
  const totalBudget=Number(standard.available||0)+standardActive.reduce((s,id)=>s+Number(meta.counts[ids.indexOf(id)]||0),0)-coreReserve;
  let expectedUltra=0,remaining=Math.max(0,totalBudget);
  for(let i=0;i<ids.length;i++){
    const cost=Number(meta.counts[i]||0);if(cost>0&&cost<=remaining){expectedUltra++;remaining-=cost;}else break;
  }
  const ultra=await waitState(worker,{minBoost:expectedUltra,requireUltra:true},22000);
  const ultraActive=ultra.enabled.filter((x)=>ids.includes(x));
  if(ultraActive.length!==expectedUltra)throw new Error(`ULTRA adaptive boost mismatch: expected=${expectedUltra}, state=${JSON.stringify(ultra)}`);
  if(!ultra.enabled.includes("standard")||!ultra.enabled.includes("ultra"))throw new Error(`core rulesets disturbed by boost: ${ultra.enabled.join(",")}`);
  if(ultraActive.some((id,index)=>id!==ids[index]))throw new Error(`boost packs must activate in priority order: ${ultraActive.join(",")}`);
  const activeRules=ultraActive.reduce((s,id)=>s+Number(meta.counts[ids.indexOf(id)]||0),0);
  log("PASS",JSON.stringify({packaged:meta.total,activeSets:ultraActive,activeRules,coreUltra:coreReserve,available:ultra.available}));
}finally{
  if(browser)try{await browser.close();}catch(_){}
}
