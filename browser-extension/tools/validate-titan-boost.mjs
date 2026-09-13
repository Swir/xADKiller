import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const read = (p) => JSON.parse(fs.readFileSync(path.join(base, p), "utf8"));
const fail = (m) => { throw new Error(`TITAN Static Boost: ${m}`); };

const manifest = read("manifest.json");
const resources = manifest.declarative_net_request?.rule_resources || [];
const expectedIds = ["titan_boost_1","titan_boost_2","titan_boost_3"];
for (let i = 0; i < expectedIds.length; i++) {
  const id = expectedIds[i];
  const item = resources.find((r) => r.id === id);
  if (!item) fail(`manifest ruleset missing ${id}`);
  if (item.enabled !== false) fail(`${id} must ship disabled and be quota-enabled at runtime`);
  if (item.path !== `rules/titan-boost-${i+1}.json`) fail(`${id} path mismatch`);
}

const meta = read("titan-boost-meta.json");
if (!Array.isArray(meta.counts) || meta.counts.length !== 3) fail("metadata counts missing");
if (Number(meta.total || 0) !== meta.counts.reduce((a,b)=>a+Number(b||0),0)) fail("metadata total mismatch");
if (meta.total < 15000 || meta.total > 30000) fail(`unexpected packaged boost total ${meta.total}`);

for (let i = 0; i < 3; i++) {
  const rules = read(`rules/titan-boost-${i+1}.json`);
  if (rules.length !== Number(meta.counts[i])) fail(`boost ${i+1} count mismatch`);
  if (rules.length < 1000 || rules.length > 10000) fail(`boost ${i+1} invalid size ${rules.length}`);
  const ids = new Set();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id <= 0 || ids.has(rule.id)) fail(`boost ${i+1} bad id ${rule.id}`);
    ids.add(rule.id);
    if (!["block","allow"].includes(rule.action?.type)) fail(`boost ${i+1} unsafe action ${rule.action?.type}`);
    if (!rule.condition?.urlFilter || rule.condition?.regexFilter) fail(`boost ${i+1} malformed filter ${rule.id}`);
    if (!Array.isArray(rule.condition.resourceTypes) || !rule.condition.resourceTypes.length) fail(`boost ${i+1} missing types ${rule.id}`);
  }
}

const worker = fs.readFileSync(path.join(base,"service-worker.js"),"utf8");
const engine = fs.readFileSync(path.join(base,"static-boost.js"),"utf8");
if (!worker.includes("static-boost.js")) fail("service worker does not load static boost engine");
if (!engine.includes("getAvailableStaticRuleCount")) fail("runtime quota probe missing");
if (!engine.includes("titan_boost_1") || !engine.includes("titan_boost_3")) fail("boost ruleset identifiers missing");
if (!engine.includes("updateEnabledRulesets")) fail("adaptive ruleset activation missing");

console.log(`OK: TITAN Adaptive Static Boost validated: ${meta.counts.join("+")} = ${meta.total} optional static rules`);
