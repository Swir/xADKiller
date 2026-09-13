import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const manifest = readJson(path.join(base, "manifest.json"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.version !== "1.2.0") fail(`unexpected version ${manifest.version}`);
if (Number(manifest.minimum_chrome_version) < 121) fail("minimum Chrome must be >=121");
for (const p of ["storage","declarativeNetRequest","declarativeNetRequestFeedback","activeTab"]) {
  if (!manifest.permissions?.includes(p)) fail(`missing permission ${p}`);
}
if (!manifest.host_permissions?.includes("<all_urls>")) fail("missing host access");
if (manifest.background?.service_worker !== "background.js") fail("service worker missing");
const rs = manifest.declarative_net_request?.rule_resources || [];
if (!rs.some((x) => x.id === "standard" && x.enabled === true)) fail("standard ruleset missing/enabled state wrong");
if (!rs.some((x) => x.id === "ultra" && x.enabled === false)) fail("ultra ruleset missing/enabled state wrong");
const contentJs = manifest.content_scripts?.[0]?.js || [];
if (contentJs[0] !== "cosmetic-data.js" || !contentJs.includes("content.js")) fail("cosmetic data must load before content.js");

for (const rel of [
  "background.js","content.js","cosmetic-data.js","build-meta.js","dynamic-intel-meta.json",
  "popup.html","popup.js","popup.css","rules/standard.json","rules/ultra.json","rules/dynamic-intel.json","icons/icon128.png"
]) {
  if (!fs.existsSync(path.join(base, rel))) fail(`missing ${rel}`);
}

function overlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
  const bs = new Set(b);
  return [...new Set(a)].filter((x) => bs.has(x));
}

function validateRules(name, min, max) {
  const rules = readJson(path.join(base, "rules", `${name}.json`));
  if (rules.length < min) fail(`${name}: too few rules ${rules.length}`);
  if (rules.length > max) fail(`${name}: too many rules ${rules.length}`);
  const ids = new Set();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id <= 0) fail(`${name}: invalid id`);
    if (ids.has(rule.id)) fail(`${name}: duplicate id ${rule.id}`);
    ids.add(rule.id);
    if (!["block","allow"].includes(rule.action?.type)) fail(`${name} ${rule.id}: unsafe action ${rule.action?.type}`);
    if (!rule.condition?.urlFilter) fail(`${name} ${rule.id}: urlFilter missing`);
    if (rule.condition.regexFilter) fail(`${name} ${rule.id}: regex rules disabled for beta`);
    if (!Array.isArray(rule.condition?.resourceTypes) || !rule.condition.resourceTypes.length) fail(`${name} ${rule.id}: resourceTypes missing`);

    const resourceOverlap = overlap(rule.condition.resourceTypes, rule.condition.excludedResourceTypes);
    if (resourceOverlap.length) fail(`${name} ${rule.id}: resourceTypes overlap excludedResourceTypes: ${resourceOverlap.join(",")}`);
    const initiatorOverlap = overlap(rule.condition.initiatorDomains, rule.condition.excludedInitiatorDomains);
    if (initiatorOverlap.length) fail(`${name} ${rule.id}: initiatorDomains overlap excludedInitiatorDomains: ${initiatorOverlap.join(",")}`);
    const requestOverlap = overlap(rule.condition.requestDomains, rule.condition.excludedRequestDomains);
    if (requestOverlap.length) fail(`${name} ${rule.id}: requestDomains overlap excludedRequestDomains: ${requestOverlap.join(",")}`);
  }
  return rules.length;
}

const standard = validateRules("standard", 1000, 20000);
const ultra = validateRules("ultra", 1000, 10000);
if (standard + ultra > 30000) fail(`total static rules exceed guaranteed 30k: ${standard + ultra}`);

const intel = readJson(path.join(base, "rules", "dynamic-intel.json"));
if (!Array.isArray(intel)) fail("dynamic intelligence pack must be an array");
if (intel.length < 18000) fail(`dynamic intelligence pack too small: ${intel.length}`);
if (intel.length > 24000) fail(`dynamic intelligence pack too large: ${intel.length}`);
if (new Set(intel).size !== intel.length) fail("dynamic intelligence pack contains duplicates");
for (const domain of intel.slice(0, 200)) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domain)) fail(`invalid dynamic intelligence domain: ${domain}`);
}

for (const lang of ["en","pl","es","de","fr"]) {
  const messages = readJson(path.join(base, "_locales", lang, "messages.json"));
  for (const key of ["extName","extDescription","protection","filterMode","modeUltra","smartEngine","pickElement","statusOn","statusOff"]) {
    if (!messages[key]?.message) fail(`${lang}: missing ${key}`);
  }
}

for (const rel of ["background.js","content.js","popup.js"]) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) fail(`${rel}: dynamic code execution forbidden`);
  if (/importScripts\s*\(\s*["']https?:/i.test(code)) fail(`${rel}: remote hosted code forbidden`);
}

if (!process.exitCode) console.log(`OK: Chrome Ultra v1.2.0 validated: ${standard} STANDARD + ${ultra} ULTRA static, ${intel.length} dynamic intelligence domains, 5 locales`);
