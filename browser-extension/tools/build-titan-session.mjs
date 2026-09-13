import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const rulesDir = path.join(out, "rules");
const LIMIT = 4500;

const SOURCES = [
  { id:"easylist", url:"https://easylist.to/easylist/easylist.txt", weight:5 },
  { id:"easyprivacy", url:"https://easylist.to/easylist/easyprivacy.txt", weight:5 },
  { id:"adguard-base", url:"https://filters.adtidy.org/extension/chromium/filters/2.txt", weight:4 },
  { id:"adguard-tracking", url:"https://filters.adtidy.org/extension/chromium/filters/3.txt", weight:5 }
];

const TYPES = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"];
const TYPE_MAP = {script:"script",image:"image",stylesheet:"stylesheet",xhr:"xmlhttprequest",xmlhttprequest:"xmlhttprequest",subdocument:"sub_frame",frame:"sub_frame",media:"media",font:"font",ping:"ping",websocket:"websocket",other:"other"};
const STRONG = /(\/ads?(?:[._\/-]|$)|adserver|adservice|adrequest|advert|banner|sponsor|promot|track|analytics|telemetr|metric|pixel|beacon|pagead|gampad|securepubads|prebid|vast|vmap|ima3|doubleclick|googlesyndication|hotjar|mouseflow|sentry|bugsnag)/i;
const FIRST_PARTY_WORTHY = /(\/ads?(?:[._\/-]|$)|\/adserver|\/adservice|\/adrequest|\/pagead|\/gampad|\/securepubads|\/prebid|\/vast|\/vmap|\/ima3|\/commercial|\/sponsor|\/promoted|[?&](?:ad_unit|adunit|ad_slot|adslot|gdfp_req|iu)=)/i;
const UNSUPPORTED = /^(redirect|redirect-rule|removeparam|csp|replace|urltransform|header|cookie|popup|popunder|permissions|webrtc|generichide|genericblock|elemhide|specifichide|badfilter)/i;

function cleanDomain(v){return String(v||"").trim().toLowerCase().replace(/^\*\./,"").replace(/^\.+|\.+$/g,"");}
function validDomain(v){return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(v)&&!v.includes("..");}
function fnv1a(text){let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
function validFilter(s){if(!s||s.length<4||s.length>260||/[^\x21-\x7E]/.test(s)||s.startsWith("||*")||s.includes("|"))return false;return true;}
function parseOptions(raw){
  const condition={}; const positives=[]; const negatives=[]; const initiators=[]; const excluded=[];
  if(!raw) return {ok:true,condition:{resourceTypes:[...TYPES]}};
  for(const p0 of raw.split(",")){
    const p=p0.trim(); if(!p)continue; if(UNSUPPORTED.test(p))return {ok:false};
    if(p==="third-party"||p==="3p"){condition.domainType="thirdParty";continue;}
    if(p==="~third-party"||p==="1p"){condition.domainType="firstParty";continue;}
    if(p==="important"||p==="match-case")continue;
    if(p.startsWith("domain=")){
      for(const d0 of p.slice(7).split("|")){const neg=d0.startsWith("~");const d=cleanDomain(neg?d0.slice(1):d0);if(validDomain(d))(neg?excluded:initiators).push(d);}continue;
    }
    const neg=p.startsWith("~"); const key=neg?p.slice(1):p; const mapped=TYPE_MAP[key]; if(mapped)(neg?negatives:positives).push(mapped);
  }
  const negSet=new Set(negatives); const base=positives.length?[...new Set(positives)]:[...TYPES]; const effective=base.filter(x=>!negSet.has(x));
  if(!effective.length)return {ok:false}; condition.resourceTypes=effective;
  const ex=new Set(excluded); const inc=[...new Set(initiators)].filter(d=>!ex.has(d));
  if(initiators.length&&!inc.length)return {ok:false}; if(inc.length)condition.initiatorDomains=inc.slice(0,100); if(ex.size)condition.excludedInitiatorDomains=[...ex].slice(0,100);
  return {ok:true,condition};
}
function parseLine(line0,sourceWeight){
  let line=String(line0||"").trim();
  if(!line||line.startsWith("!")||line.startsWith("[")||line.startsWith("#")||line.startsWith("@@")||line.includes("##")||line.includes("#@#")||line.includes("#$#")||line.includes("#?#"))return null;
  let pattern=line,options=""; const dollar=line.indexOf("$"); if(dollar>=0){pattern=line.slice(0,dollar);options=line.slice(dollar+1);} pattern=pattern.trim();
  if(pattern.startsWith("||")||pattern.startsWith("|http://")||pattern.startsWith("|https://"))return null;
  if(pattern.length>2&&pattern.startsWith("/")&&pattern.endsWith("/"))return null;
  if(!validFilter(pattern)||!STRONG.test(pattern))return null;
  const parsed=parseOptions(options); if(!parsed.ok)return null;
  let score=sourceWeight*20;
  if(FIRST_PARTY_WORTHY.test(pattern))score+=120;
  if(parsed.condition.domainType==="firstParty")score+=80;
  if(parsed.condition.domainType==="thirdParty")score+=35;
  if(parsed.condition.resourceTypes.includes("script"))score+=20;
  if(parsed.condition.resourceTypes.includes("xmlhttprequest"))score+=20;
  if(/(?:pagead|gampad|securepubads|prebid|vast|vmap|ima3)/i.test(pattern))score+=45;
  return {priority:65,action:{type:"block"},condition:{urlFilter:pattern,...parsed.condition},score};
}
async function fetchText(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),30000);try{const r=await fetch(url,{signal:c.signal,headers:{"user-agent":"xADKiller-Chrome/1.4.0-TITAN-Session"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}finally{clearTimeout(t);}}

const map=new Map(); const status=[];
for(const source of SOURCES){
  try{
    const text=await fetchText(source.url); let parsedCount=0;
    for(const line of text.replace(/^\uFEFF/,"").split(/\r?\n/)){
      const item=parseLine(line,source.weight); if(!item)continue; parsedCount++;
      const key=JSON.stringify({action:item.action,condition:item.condition}); const old=map.get(key);
      if(!old||item.score>old.score)map.set(key,{...item,key,hash:fnv1a(key)});
    }
    status.push({id:source.id,ok:true,parsed:parsedCount});
  }catch(error){status.push({id:source.id,ok:false,error:String(error?.message||error)});}
}
const ranked=[...map.values()].sort((a,b)=>b.score-a.score||a.hash-b.hash).slice(0,LIMIT);
if(ranked.length<1200)throw new Error(`Too few TITAN session rules: ${ranked.length}`);
const rules=ranked.map((r,i)=>({id:200000+i,priority:r.priority,action:r.action,condition:r.condition}));
fs.mkdirSync(rulesDir,{recursive:true});
fs.writeFileSync(path.join(rulesDir,"titan-session.json"),JSON.stringify(rules));
fs.writeFileSync(path.join(out,"titan-session-meta.json"),JSON.stringify({version:"1.4.0",rules:rules.length,sources:status},null,2));
console.log(JSON.stringify({titanSessionRules:rules.length,sources:status},null,2));
