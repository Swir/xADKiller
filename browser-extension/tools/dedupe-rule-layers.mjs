import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const rulesDir = path.join(out, "rules");
const checkOnly = process.argv.includes("--check");
const BLOCK_TYPES = ["font","image","media","other","ping","script","stylesheet","sub_frame","websocket","xmlhttprequest"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value, compact = false) {
  fs.writeFileSync(file, JSON.stringify(value, null, compact ? 0 : 2));
}

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toLowerCase()))].sort();
}

function normalizedCondition(condition = {}) {
  const out = {};
  for (const key of Object.keys(condition).sort()) {
    const value = condition[key];
    if (Array.isArray(value)) out[key] = normalizedList(value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

function semanticKey(rule) {
  const action = typeof rule?.action === "string" ? rule.action : rule?.action?.type;
  const condition = normalizedCondition(rule?.condition || {});
  return JSON.stringify({ action: String(action || ""), condition });
}

function staticDomain(rule) {
  const action = typeof rule?.action === "string" ? rule.action : rule?.action?.type;
  if (action !== "block") return "";
  const condition = rule?.condition || {};
  if (condition.domainType || condition.initiatorDomains?.length || condition.excludedInitiatorDomains?.length) return "";
  const types = normalizedList(condition.resourceTypes);
  if (JSON.stringify(types) !== JSON.stringify(BLOCK_TYPES)) return "";
  const filter = String(condition.urlFilter || "");
  const match = filter.match(/^\|\|([a-z0-9.-]+)\^$/i);
  return match ? match[1].toLowerCase() : "";
}

function dedupeAgainst(rules, blockedKeys) {
  const kept = [];
  let removed = 0;
  const own = new Set();
  for (const rule of rules) {
    const key = semanticKey(rule);
    if (blockedKeys.has(key) || own.has(key)) {
      removed++;
      continue;
    }
    own.add(key);
    kept.push(rule);
  }
  return { kept, removed, keys: own };
}

function duplicateCount(rules, blockedKeys = new Set()) {
  let duplicates = 0;
  const own = new Set();
  for (const rule of rules) {
    const key = semanticKey(rule);
    if (blockedKeys.has(key) || own.has(key)) duplicates++;
    else own.add(key);
  }
  return duplicates;
}

const standardFile = path.join(rulesDir, "standard.json");
const ultraFile = path.join(rulesDir, "ultra.json");
const dynamicFile = path.join(rulesDir, "dynamic-intel.json");
const sessionFile = path.join(rulesDir, "titan-session.json");
for (const file of [standardFile, ultraFile, dynamicFile, sessionFile]) {
  if (!fs.existsSync(file)) throw new Error(`missing_rule_layer_${path.basename(file)}`);
}

const standard = readJson(standardFile);
let ultra = readJson(ultraFile);
let dynamic = readJson(dynamicFile);
let session = readJson(sessionFile);
const standardKeys = new Set(standard.map(semanticKey));
const standardDomains = new Set(standard.map(staticDomain).filter(Boolean));

const ultraResult = dedupeAgainst(ultra, standardKeys);
ultra = ultraResult.kept;
const staticKeys = new Set([...standardKeys, ...ultra.map(semanticKey)]);
const staticDomains = new Set([...standardDomains, ...ultra.map(staticDomain).filter(Boolean)]);

const dynamicSeen = new Set();
let dynamicRemoved = 0;
dynamic = dynamic.filter((raw) => {
  const domain = String(raw || "").trim().toLowerCase();
  if (!domain || staticDomains.has(domain) || dynamicSeen.has(domain)) {
    dynamicRemoved++;
    return false;
  }
  dynamicSeen.add(domain);
  return true;
});

const sessionResult = dedupeAgainst(session, staticKeys);
session = sessionResult.kept;

const stats = {
  standard: standard.length,
  ultra: ultra.length,
  dynamic: dynamic.length,
  session: session.length,
  removed: {
    ultraVsStandard: ultraResult.removed,
    dynamicVsStatic: dynamicRemoved,
    sessionVsStatic: sessionResult.removed
  }
};

if (!checkOnly) {
  writeJson(ultraFile, ultra);
  writeJson(dynamicFile, dynamic, true);
  writeJson(sessionFile, session, true);

  const sessionMetaFile = path.join(out, "titan-session-meta.json");
  if (fs.existsSync(sessionMetaFile)) {
    const meta = readJson(sessionMetaFile);
    meta.rules = session.length;
    meta.crossLayerDuplicatesRemoved = sessionResult.removed;
    writeJson(sessionMetaFile, meta);
  }
  const dynamicMetaFile = path.join(out, "dynamic-intel-meta.json");
  if (fs.existsSync(dynamicMetaFile)) {
    const meta = readJson(dynamicMetaFile);
    meta.domains = dynamic.length;
    meta.crossLayerDuplicatesRemoved = dynamicRemoved;
    writeJson(dynamicMetaFile, meta);
  }
  fs.writeFileSync(path.join(out, "rule-layer-dedupe-meta.json"), JSON.stringify({
    version: 1,
    strategy: "semantic-static-dynamic-session-dedupe",
    ...stats
  }, null, 2));
}

const finalUltra = checkOnly ? readJson(ultraFile) : ultra;
const finalDynamic = checkOnly ? readJson(dynamicFile) : dynamic;
const finalSession = checkOnly ? readJson(sessionFile) : session;
const finalStaticKeys = new Set(standard.map(semanticKey));
const ultraDuplicates = duplicateCount(finalUltra, finalStaticKeys);
for (const rule of finalUltra) finalStaticKeys.add(semanticKey(rule));
const finalStaticDomains = new Set([
  ...standard.map(staticDomain).filter(Boolean),
  ...finalUltra.map(staticDomain).filter(Boolean)
]);
const dynamicDuplicates = finalDynamic.filter((domain, index, arr) =>
  finalStaticDomains.has(String(domain).toLowerCase()) || arr.indexOf(domain) !== index).length;
const sessionDuplicates = duplicateCount(finalSession, finalStaticKeys);

if (ultraDuplicates || dynamicDuplicates || sessionDuplicates) {
  throw new Error(`cross_layer_duplicates ultra=${ultraDuplicates} dynamic=${dynamicDuplicates} session=${sessionDuplicates}`);
}
if (finalUltra.length < 7000) throw new Error(`too_few_ultra_after_dedupe_${finalUltra.length}`);
if (finalDynamic.length < 18000) throw new Error(`too_few_dynamic_after_dedupe_${finalDynamic.length}`);
if (finalSession.length < 1200) throw new Error(`too_few_session_after_dedupe_${finalSession.length}`);

console.log(JSON.stringify({
  mode: checkOnly ? "check" : "rewrite",
  ...stats,
  verifiedDuplicates: { ultraVsStandard: 0, dynamicVsStatic: 0, sessionVsStatic: 0 }
}, null, 2));
