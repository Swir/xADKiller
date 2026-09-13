import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const manifest = readJson(path.join(base, "manifest.json"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.version !== "1.3.0") fail(`unexpected version ${manifest.version}`);
if (Number(manifest.minimum_chrome_version) < 121) fail("minimum Chrome must be >=121");
for (const p of ["storage","alarms","declarativeNetRequest","declarativeNetRequestFeedback","activeTab"]) {
  if (!manifest.permissions?.includes(p)) fail(`missing permission ${p}`);
}
if (!manifest.host_permissions?.includes("<all_urls>")) fail("missing host access");
if (manifest.background?.service_worker !== "background.js") fail("service worker missing");
const rs = manifest.declarative_net_request?.rule_resources || [];
if (!rs.some((x) => x.id === "standard" && x.enabled === true)) fail("standard ruleset missing/enabled state wrong");
if (!rs.some((x) => x.id === "ultra" && x.enabled === false)) fail("ultra ruleset missing/enabled state wrong");

const scripts = manifest.content_scripts || [];
const mainGuard = scripts.find((x) => x.world === "MAIN" && x.js?.includes("early-guard.js"));
if (!mainGuard || mainGuard.run_at !== "document_start" || mainGuard.all_frames !== true) fail("MAIN-world Preflight Guard missing or not document_start/all_frames");
const isolated = scripts.find((x) => x.world === "ISOLATED" && x.js?.includes("content.js"));
if (!isolated) fail("isolated content engine missing");
if (!isolated.js?.includes("preflight-config.js")) fail("Preflight state bridge missing");
const cosmeticIndex = isolated.js?.indexOf("cosmetic-data.js") ?? -1;
const contentIndex = isolated.js?.indexOf("content.js") ?? -1;
if (cosmeticIndex < 0 || contentIndex < 0 || cosmeticIndex > contentIndex) fail("cosmetic data must load before content.js");
if (!isolated.js?.includes("shadow-sentinel.js")) fail("Shadow DOM Sentinel missing");
if (isolated.all_frames !== true) fail("isolated engine must run in all frames");

for (const rel of [
  "background.js","early-guard.js","preflight-config.js","content.js","shadow-sentinel.js","cosmetic-data.js","build-meta.js","dynamic-intel-meta.json",
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

const background = fs.readFileSync(path.join(base, "background.js"), "utf8");
if (!background.includes("xadkiller-live-shield.json")) fail("Live Shield feed endpoint missing");
if (!background.includes("chrome.alarms")) fail("Live Shield periodic refresh missing");
if (!background.includes("LIVE_RULE_MIN")) fail("Live Shield dynamic rule range missing");

const guard = fs.readFileSync(path.join(base, "early-guard.js"), "utf8");
const bridge = fs.readFileSync(path.join(base, "preflight-config.js"), "utf8");
if (!guard.includes("xadkiller:preflight-config") || !bridge.includes("xadkiller:preflight-config")) fail("Preflight state synchronization missing");
if (!guard.includes("wss?") && !guard.includes("websocket")) fail("Preflight WebSocket handling missing");

for (const lang of ["en","pl","es","de","fr"]) {
  const messages = readJson(path.join(base, "_locales", lang, "messages.json"));
  for (const key of ["extName","extDescription","protection","filterMode","modeUltra","smartEngine","pickElement","statusOn","statusOff","liveShield","updateNow"]) {
    if (!messages[key]?.message) fail(`${lang}: missing ${key}`);
  }
}

for (const rel of ["background.js","early-guard.js","preflight-config.js","content.js","shadow-sentinel.js","popup.js"]) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) fail(`${rel}: dynamic code execution forbidden`);
  if (/importScripts\s*\(\s*["']https?:/i.test(code)) fail(`${rel}: remote hosted code forbidden`);
}

if (!process.exitCode) console.log(`OK: Chrome Shield v1.3.0 validated: ${standard} STANDARD + ${ultra} ULTRA static, ${intel.length} packaged intelligence domains, Preflight Guard + state bridge + Shadow DOM Sentinel + Live Shield`);
