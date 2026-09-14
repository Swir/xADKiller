import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const manifest = readJson(path.join(base, "manifest.json"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.version !== "1.4.0") fail(`unexpected version ${manifest.version}`);
if (Number(manifest.minimum_chrome_version) < 121) fail("minimum Chrome must be >=121");
for (const p of ["storage","alarms","declarativeNetRequest","activeTab"]) {
  if (!manifest.permissions?.includes(p)) fail(`missing permission ${p}`);
}
if (manifest.permissions?.includes("declarativeNetRequestFeedback")) fail("store build must not request declarativeNetRequestFeedback");
if (!manifest.host_permissions?.includes("<all_urls>")) fail("missing host access");
if (manifest.background?.service_worker !== "service-worker.js") fail("composite service worker missing");
const rs = manifest.declarative_net_request?.rule_resources || [];
if (!rs.some((x) => x.id === "standard" && x.enabled === true)) fail("standard ruleset missing/enabled state wrong");
if (rs.some((x) => x.id === "compat")) fail("COMPAT allow ruleset must not be referenced by active Chrome manifest");
if (!rs.some((x) => x.id === "ultra" && x.enabled === false)) fail("ultra ruleset missing/enabled state wrong");

const scripts = manifest.content_scripts || [];
const mainGuard = scripts.find((x) => x.world === "MAIN" && x.js?.includes("early-guard.js"));
if (!mainGuard || mainGuard.run_at !== "document_start" || mainGuard.all_frames !== true) fail("MAIN-world guard missing or not document_start/all_frames");
if (!mainGuard.js?.includes("titan-main.js")) fail("TITAN MAIN-world guard missing");
const isolated = scripts.find((x) => x.world === "ISOLATED" && x.js?.includes("content.js"));
if (!isolated) fail("isolated content engine missing");
for (const rel of ["preflight-config.js","shadow-sentinel.js","live-cosmetic.js","network-scout.js"]) {
  if (!isolated.js?.includes(rel)) fail(`isolated layer missing ${rel}`);
}
const cosmeticIndex = isolated.js?.indexOf("cosmetic-data.js") ?? -1;
const contentIndex = isolated.js?.indexOf("content.js") ?? -1;
if (cosmeticIndex < 0 || contentIndex < 0 || cosmeticIndex > contentIndex) fail("cosmetic data must load before content.js");
if (isolated.all_frames !== true) fail("isolated engine must run in all frames");

for (const rel of [
  "service-worker.js","background.js","live-signatures.js","titan-engine.js","static-boost.js","titan-main.js","network-scout.js","early-guard.js","preflight-config.js","content.js","shadow-sentinel.js","live-cosmetic.js","cosmetic-data.js","build-meta.js","dynamic-intel-meta.json","titan-session-meta.json",
  "popup.html","popup.js","popup.css","rules/standard.json","rules/ultra.json","rules/dynamic-intel.json","rules/titan-session.json","icons/icon128.png"
]) {
  if (!fs.existsSync(path.join(base, rel))) fail(`missing ${rel}`);
}

const composite = fs.readFileSync(path.join(base, "service-worker.js"), "utf8");
for (const engine of ["background.js","live-signatures.js","titan-engine.js","static-boost.js"]) if (!composite.includes(engine)) fail(`composite worker missing ${engine}`);
if (composite.includes("compat-engine.js")) fail("COMPAT engine must not be imported by Chrome service worker");

function overlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
  const bs = new Set(b);
  return [...new Set(a)].filter((x) => bs.has(x));
}
function validateRules(name, min, max, expectedAction) {
  const rules = readJson(path.join(base, "rules", `${name}.json`));
  if (rules.length < min) fail(`${name}: too few rules ${rules.length}`);
  if (rules.length > max) fail(`${name}: too many rules ${rules.length}`);
  const ids = new Set();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id <= 0) fail(`${name}: invalid id`);
    if (ids.has(rule.id)) fail(`${name}: duplicate id ${rule.id}`);
    ids.add(rule.id);
    if (rule.action?.type !== expectedAction) fail(`${name} ${rule.id}: expected ${expectedAction}, got ${rule.action?.type}`);
    if (!rule.condition?.urlFilter) fail(`${name} ${rule.id}: urlFilter missing`);
    if (rule.condition.regexFilter) fail(`${name} ${rule.id}: regex rules must be runtime-validated TITAN rules, not static`);
    if (!Array.isArray(rule.condition?.resourceTypes) || !rule.condition.resourceTypes.length) fail(`${name} ${rule.id}: resourceTypes missing`);
    const resourceOverlap = overlap(rule.condition.resourceTypes, rule.condition.excludedResourceTypes);
    if (resourceOverlap.length) fail(`${name} ${rule.id}: resourceTypes overlap excludedResourceTypes: ${resourceOverlap.join(",")}`);
    const initiatorOverlap = overlap(rule.condition.initiatorDomains, rule.condition.excludedInitiatorDomains);
    if (initiatorOverlap.length) fail(`${name} ${rule.id}: initiatorDomains overlap excludedInitiatorDomains: ${initiatorOverlap.join(",")}`);
  }
  return rules.length;
}

const standard = validateRules("standard", 15000, 19700, "block");
const ultra = validateRules("ultra", 7000, 10000, "block");
if (standard + ultra > 29850) fail(`ULTRA static rules exceed TITAN budget: ${standard + ultra}`);

const compatPath = path.join(base, "rules", "compat.json");
let dormantCompat = 0;
if (fs.existsSync(compatPath)) {
  const compatRules = readJson(compatPath);
  dormantCompat = compatRules.length;
  if (compatRules.some((r) => r?.action?.type !== "allow")) fail("dormant COMPAT source contains non-allow rule");
}

const intel = readJson(path.join(base, "rules", "dynamic-intel.json"));
if (!Array.isArray(intel)) fail("dynamic intelligence pack must be an array");
if (intel.length < 18000 || intel.length > 24000) fail(`dynamic intelligence pack size invalid: ${intel.length}`);
if (new Set(intel).size !== intel.length) fail("dynamic intelligence pack contains duplicates");
for (const domain of intel.slice(0, 500)) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domain)) fail(`invalid dynamic intelligence domain: ${domain}`);
}

const session = readJson(path.join(base, "rules", "titan-session.json"));
if (!Array.isArray(session) || session.length < 1200 || session.length > 4500) fail(`TITAN session pack invalid size: ${session?.length || 0}`);
const sessionIds = new Set();
for (const rule of session) {
  if (!Number.isInteger(rule.id) || rule.id < 200000 || rule.id > 204499) fail(`TITAN session invalid id: ${rule.id}`);
  if (sessionIds.has(rule.id)) fail(`TITAN session duplicate id: ${rule.id}`);
  sessionIds.add(rule.id);
  if (rule.action?.type !== "block") fail(`TITAN session non-block action: ${rule.id}`);
  if (!rule.condition?.urlFilter || !Array.isArray(rule.condition?.resourceTypes) || !rule.condition.resourceTypes.length) fail(`TITAN session malformed rule: ${rule.id}`);
}

const intelMeta = readJson(path.join(base, "dynamic-intel-meta.json"));
if (intelMeta.strategy !== "weighted-consensus-diversity") fail(`unexpected dynamic intelligence strategy: ${intelMeta.strategy}`);
const titanMeta = readJson(path.join(base, "titan-session-meta.json"));
if (Number(titanMeta.rules || 0) !== session.length) fail("TITAN session metadata mismatch");

const background = fs.readFileSync(path.join(base, "background.js"), "utf8");
const liveMatrix = fs.readFileSync(path.join(base, "live-signatures.js"), "utf8");
const titan = fs.readFileSync(path.join(base, "titan-engine.js"), "utf8");
const titanMain = fs.readFileSync(path.join(base, "titan-main.js"), "utf8");
if (!background.includes("xadkiller-live-shield.json")) fail("Live Shield domain feed endpoint missing");
if (!liveMatrix.includes("raw.githubusercontent.com/Swir/xADKiller/main/")) fail("Live Matrix must use official main-branch feed");
if (!titan.includes("xadkiller-titan-feed.json")) fail("TITAN data feed endpoint missing");
if (!titan.includes("updateSessionRules") || !titan.includes("isRegexSupported")) fail("TITAN session/regex engines missing");
if (!titan.includes("titanLearnResource")) fail("TITAN adaptive network learner missing");
if (!titanMain.includes("attachShadow") || !titanMain.includes("SharedWorker") || !titanMain.includes("Document.prototype.write")) fail("TITAN MAIN-world advanced guards incomplete");

const guard = fs.readFileSync(path.join(base, "early-guard.js"), "utf8");
const bridge = fs.readFileSync(path.join(base, "preflight-config.js"), "utf8");
if (!guard.includes("xadkiller:preflight-config") || !bridge.includes("xadkiller:preflight-config")) fail("Preflight state synchronization missing");
if (!bridge.includes("mode:")) fail("Preflight mode synchronization missing");

for (const lang of ["en","pl","es","de","fr"]) {
  const messages = readJson(path.join(base, "_locales", lang, "messages.json"));
  for (const key of ["extName","extDescription","protection","filterMode","modeUltra","smartEngine","pickElement","statusOn","statusOff","liveShield","updateNow"]) {
    if (!messages[key]?.message) fail(`${lang}: missing ${key}`);
  }
}

for (const rel of ["service-worker.js","background.js","live-signatures.js","titan-engine.js","static-boost.js","titan-main.js","network-scout.js","early-guard.js","preflight-config.js","content.js","shadow-sentinel.js","live-cosmetic.js","popup.js"]) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) fail(`${rel}: dynamic code execution forbidden`);
  if (/importScripts\s*\(\s*["']https?:/i.test(code)) fail(`${rel}: remote hosted code forbidden`);
}

if (!process.exitCode) console.log(`OK: xADKiller TITAN v1.4.0 store build validated: ${standard} STANDARD block + ${ultra} ULTRA block, no active COMPAT allow ruleset, no declarativeNetRequestFeedback permission, ${intel.length} consensus dynamic domains, ${session.length} session rules${dormantCompat ? `, ${dormantCompat} dormant COMPAT source rules not referenced` : ""}`);
