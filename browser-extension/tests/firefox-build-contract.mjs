import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname,"..");
const out = path.join(root,"dist","firefox");
const manifest = JSON.parse(fs.readFileSync(path.join(out,"manifest.json")));
assert(!manifest.permissions.includes("declarativeNetRequestFeedback"));
assert.equal(manifest.background.service_worker,undefined);
assert.equal(manifest.browser_specific_settings.gecko.id,"xadkiller@swir.github");
for (const name of [...manifest.background.scripts,...manifest.content_scripts.flatMap(x=>x.js)]) assert(fs.existsSync(path.join(out,name)),name);
for (const entry of fs.readdirSync(out,{recursive:true})) assert(!String(entry).includes("test-"),`Test file leaked: ${entry}`);
for (const set of manifest.declarative_net_request.rule_resources) {
  const file=path.join(out,set.path); assert(fs.statSync(file).size<5*1024*1024);
  const rules=JSON.parse(fs.readFileSync(file));
  assert.equal(new Set(rules.map(r=>r.id)).size,rules.length);
  assert(rules.every(r=>r.action.type==="block"));
}
const chromeManifest=JSON.parse(fs.readFileSync(path.join(root,"chrome","manifest.json")));
assert.equal(chromeManifest.background.service_worker,"service-worker.js");
const intel=Array.from({length:24000},(_,i)=>`intel${i}.example`);
const custom=Array.from({length:4500},(_,i)=>`custom${i}.example`);
const allow=Array.from({length:450},(_,i)=>`allow${i}.example`);
const live=Array.from({length:900},(_,i)=>`live${i}.example`);
async function generate(size) {
  let generated;
  const event={addListener(){}};
  const context=vm.createContext({self:{XAD_PLATFORM:size?{domainRuleGroupSize:size}:undefined},URL,console,
    chrome:{runtime:{onInstalled:event,onStartup:event,onMessage:event},alarms:{onAlarm:event},
      declarativeNetRequest:{updateDynamicRules(payload,callback){generated=payload.addRules;callback();}}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,"common","background.js"),"utf8"),context);
  context.loadIntelDomains=async()=>intel;
  context.loadLiveFeed=async()=>({standard:live.slice(0,500),ultra:live.slice(500)});
  context.dynamicRules=async()=>[];
  await new Promise((resolve,reject)=>context.rebuildDynamicRules(allow,custom,"ultra",true,error=>error?reject(new Error(error)):resolve()));
  return JSON.parse(JSON.stringify(generated));
}
const chrome=await generate();
const firefox=await generate(100);
assert(firefox.length+400+200+200+2<5000,"Maximum Firefox dynamic budget including other modules");
const expanded=rules=>rules.flatMap(rule=>rule.condition.requestDomains
  ? rule.condition.requestDomains.map(domain=>JSON.stringify({priority:rule.priority,action:rule.action,condition:{...rule.condition,requestDomains:[domain]}}))
  :[JSON.stringify({priority:rule.priority,action:rule.action,condition:rule.condition})]).sort();
assert.deepEqual(expanded(firefox),expanded(chrome),"Grouping preserves complete rule semantics, allow precedence and custom domains");
assert.equal(chrome.filter(r=>r.id>=100000&&r.id<=123999).length,24000,"Chrome behavior stays ungrouped");
console.log(`PASS Firefox package contract; worst-case dynamic rules=${firefox.length}+802 reserved; Chrome/Firefox domain coverage equivalent`);
