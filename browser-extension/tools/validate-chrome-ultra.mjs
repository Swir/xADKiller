import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const manifest = readJson(path.join(base, "manifest.json"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.version !== "1.1.0") fail(`unexpected version ${manifest.version}`);
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

for (const rel of ["background.js","content.js","cosmetic-data.js","build-meta.js","popup.html","popup.js","popup.css","rules/standard.json","rules/ultra.json","icons/icon128.png"]) {
  if (!fs.existsSync(path.join(base, rel))) fail(`missing ${rel}`);
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
  }
  return rules.length;
}
const standard = validateRules("standard", 1000, 20000);
const ultra = validateRules("ultra", 1000, 10000);
if (standard + ultra > 30000) fail(`total rules exceed guaranteed 30k: ${standard + ultra}`);

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

if (!process.exitCode) console.log(`OK: Chrome Ultra validated: ${standard} STANDARD + ${ultra} ULTRA rules, 5 locales, adaptive DOM engine`);
