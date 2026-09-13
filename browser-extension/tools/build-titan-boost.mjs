import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const rulesDir = path.join(out, "rules");

const SOURCES = [
  { id:"easylist", url:"https://easylist.to/easylist/easylist.txt", weight:6 },
  { id:"easyprivacy", url:"https://easylist.to/easylist/easyprivacy.txt", weight:6 },
  { id:"adguard-base", url:"https://filters.adtidy.org/extension/chromium/filters/2.txt", weight:5 },
  { id:"adguard-tracking", url:"https://filters.adtidy.org/extension/chromium/filters/3.txt", weight:6 }
];
const SET_SIZE = 10000;
const SET_COUNT = 3;
const TOTAL = SET_SIZE * SET_COUNT;
const ALL_TYPES = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"];
const TYPE_MAP = {script:"script",image:"image",stylesheet:"stylesheet",xhr:"xmlhttprequest",xmlhttprequest:"xmlhttprequest",subdocument:"sub_frame",frame:"sub_frame",media:"media",font:"font",ping:"ping",websocket:"websocket",other:"other"};
const UNSUPPORTED = /^(redirect|redirect-rule|removeparam|csp|replace|urltransform|header|cookie|popup|popunder|permissions|webrtc|generichide|genericblock|elemhide|specifichide|badfilter)/i;
const SIGNAL = /(ads?|advert|banner|sponsor|promot|track|analytics|telemetr|metric|pixel|beacon|pagead|gampad|securepubads|prebid|vast|vmap|ima3|doubleclick|googlesyndication|googleadservices|adnxs|adsrvr|pubmatic|rubicon|criteo|taboola|outbrain|smartadserver|adform|hotjar|mouseflow|luckyorange|fullstory|logrocket|appsflyer|adjust|branch|kochava|sentry|bugsnag)/i;

function cleanDomain(v){return String(v||"").trim().toLowerCase().replace(/^\*\./,"").replace(/^\.+|\.+$/g,"");}
function validDomain(v){return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(v)&&!v.includes("..");}
function fnv1a(text){let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
function validFilter(pattern){
  if(!pattern||pattern.length<4||pattern.length>300||/[^\x21-\x7E]/.test(pattern)||pattern.startsWith("||*"))return false;
  let body=pattern;
  if(body.startsWith("||")){body=body.slice(2);if(!/^[a-z0-9]/i.test(body))return false;}
  else if(body.startsWith("|")){body=body.slice(1);}
  if(body.endsWith("|"))body=body.slice(0,-1);
  return !!body&&!body.includes("|");
}
function parseOptions(raw){
  const condition={}; const positives=[]; const negatives=[]; const initiators=[]; const excluded=[];
  if(!raw)return {ok:true,condition:{resourceTypes:[...ALL_TYPES]}};
  for(const p0 of raw.split(",")){
    const p=p0.trim(); if(!p)continue; if(UNSUPPORTED.test(p))return {ok:false};
    if(p==="third-party"||p==="3p"){condition.domainType="thirdParty";continue;}
    if(p==="~third-party"||p==="1p"){condition.domainType="firstParty";continue;}
    if(p==="important"){continue;}
    if(p==="match-case"){condition.isUrlFilterCaseSensitive=true;continue;}
    if(p.startsWith("domain=")){
      for(const d0 of p.slice(7).split("|")){const neg=d0.startsWith("~");const d=cleanDomain(neg?d0.slice(1):d0);if(validDomain(d))(neg?excluded:initiators).push(d);}continue;
    }
    const neg=p.startsWith("~");const mapped=TYPE_MAP[neg?p.slice(1):p];if(mapped)(neg?negatives:positives).push(mapped);
  }
  const negSet=new Set(negatives);const base=positives.length?[...new Set(positives)]:[...ALL_TYPES];const types=base.filter(x=>!negSet.has(x));
  if(!types.length)return {ok:false};condition.resourceTypes=types;
  const ex=new Set(excluded);const inc=[...new Set(initiators)].filter(d=>!ex.has(d));
  if(initiators.length&&!inc.length)return {ok:false};if(inc.length)condition.initiatorDomains=inc.slice(0,100);if(ex.size)condition.excludedInitiatorDomains=[...ex].slice(0,100);
  return {ok:true,condition};
}
function parseLine(line0,sourceWeight){
  let line=String(line0||"").trim();
  if(!line||line.startsWith("!")||line.startsWith("[")||line.startsWith("#")||line.includes("##")||line.includes("#@#")||line.includes("#$#")||line.includes("#?#")||line.includes("#%#"))return null;
  let action="block";if(line.startsWith("@@")){action="allow";line=line.slice(2);}
  let pattern=line,options="";const dollar=line.indexOf("$");if(dollar>=0){pattern=line.slice(0,dollar);options=line.slice(dollar+1);}pattern=pattern.trim();
  if(pattern.length>2&&pattern.startsWith("/")&&pattern.endsWith("/"))return null;
  if(!validFilter(pattern))return null;
  const anchored=pattern.startsWith("||")||pattern.startsWith("|http://")||pattern.startsWith("|https://");
  if(!anchored&&!SIGNAL.test(pattern))return null;
  const parsed=parseOptions(options);if(!parsed.ok)return null;
  const condition={urlFilter:pattern,...parsed.condition};
  let score=sourceWeight*18+(action==="allow"?240:0);
  if(SIGNAL.test(pattern))score+=75;
  if(!pattern.startsWith("||"))score+=35;
  if(pattern.startsWith("/"))score+=25;
  if(condition.domainType==="firstParty")score+=35;
  if(condition.domainType==="thirdParty")score+=16;
  if(condition.resourceTypes.includes("script"))score+=12;
  if(condition.resourceTypes.includes("xmlhttprequest"))score+=12;
  if(condition.initiatorDomains?.length)score+=15;
  return {action,priority:action==="allow"?110:2,condition,score};
}
function keyOf(rule){return JSON.stringify({action:rule.action,condition:rule.condition});}
function existingKeys(){
  const keys=new Set();
  for(const name of ["standard","ultra"]){
    const file=path.join(rulesDir,`${name}.json`);if(!fs.existsSync(file))continue;
    for(const r of JSON.parse(fs.readFileSync(file,"utf8"))){keys.add(JSON.stringify({action:r.action?.type,condition:r.condition}));}
  }
  return keys;
}
async function fetchText(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),30000);try{const r=await fetch(url,{signal:c.signal,headers:{"user-agent":"xADKiller-Chrome/1.4.0-TITAN-Boost"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}finally{clearTimeout(t);}}

const existing=existingKeys();
const candidates=new Map();
const status=[];
for(const source of SOURCES){
  try{
    const text=await fetchText(source.url);let parsed=0;
    for(const line of text.replace(/^\uFEFF/,"").split(/\r?\n/)){
      const r=parseLine(line,source.weight);if(!r)continue;parsed++;
      const key=keyOf(r);if(existing.has(key))continue;
      const old=candidates.get(key);if(!old||r.score>old.score)candidates.set(key,{...r,key,hash:fnv1a(key)});
    }
    status.push({id:source.id,ok:true,parsed});
  }catch(error){status.push({id:source.id,ok:false,error:String(error?.message||error)});}
}
const ranked=[...candidates.values()].sort((a,b)=>b.score-a.score||a.hash-b.hash).slice(0,TOTAL);
if(ranked.length<15000)throw new Error(`Too few TITAN boost candidates: ${ranked.length}`);
const counts=[];
for(let s=0;s<SET_COUNT;s++){
  const slice=ranked.slice(s*SET_SIZE,(s+1)*SET_SIZE);
  const rules=slice.map((r,i)=>({id:i+1,priority:r.priority,action:{type:r.action},condition:r.condition}));
  fs.writeFileSync(path.join(rulesDir,`titan-boost-${s+1}.json`),JSON.stringify(rules));
  counts.push(rules.length);
}
fs.writeFileSync(path.join(out,"titan-boost-meta.json"),JSON.stringify({version:"1.4.0",counts,total:counts.reduce((a,b)=>a+b,0),candidates:candidates.size,sources:status},null,2));
console.log(JSON.stringify({titanBoostRules:counts,total:counts.reduce((a,b)=>a+b,0),candidates:candidates.size,sources:status},null,2));
