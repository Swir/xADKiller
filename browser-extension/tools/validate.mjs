import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fail = (message) => { console.error("FAIL:", message); process.exitCode = 1; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

for (const browser of ["chrome", "firefox"]) {
  const base = path.join(root, "dist", browser);
  const manifest = readJson(path.join(base, "manifest.json"));
  if (manifest.manifest_version !== 3) fail(`${browser}: manifest_version must be 3`);
  if (manifest.version !== "1.0.0") fail(`${browser}: unexpected version`);
  if (!manifest.permissions?.includes("declarativeNetRequest")) fail(`${browser}: missing DNR permission`);
  if (!manifest.host_permissions?.includes("<all_urls>")) fail(`${browser}: missing host access`);
  for (const rel of ["background.js","content.js","popup.html","popup.js","popup.css","rules/core.json","icons/icon128.png"]) {
    if (!fs.existsSync(path.join(base, rel))) fail(`${browser}: missing ${rel}`);
  }
  if (browser === "chrome" && !manifest.background?.service_worker) fail("chrome: service worker missing");
  if (browser === "firefox") {
    const gecko = manifest.browser_specific_settings?.gecko;
    if (!manifest.background?.scripts?.includes("background.js")) fail("firefox: background.scripts missing");
    if (!gecko?.id) fail("firefox: gecko.id missing");
    if (gecko?.data_collection_permissions?.required?.[0] !== "none") fail("firefox: data_collection_permissions must declare none");
  }
}

const rules = readJson(path.join(root, "dist/chrome/rules/core.json"));
const ids = new Set();
for (const rule of rules) {
  if (!Number.isInteger(rule.id) || rule.id <= 0) fail("DNR: invalid id");
  if (ids.has(rule.id)) fail(`DNR: duplicate id ${rule.id}`);
  ids.add(rule.id);
  if (rule.action?.type !== "block") fail(`DNR ${rule.id}: expected block action`);
  if (!rule.condition?.urlFilter) fail(`DNR ${rule.id}: urlFilter missing`);
  if (!Array.isArray(rule.condition?.resourceTypes) || rule.condition.resourceTypes.length === 0) fail(`DNR ${rule.id}: resourceTypes missing`);
}
if (rules.length < 100) fail(`DNR: expected >=100 rules, got ${rules.length}`);

for (const browser of ["chrome","firefox"]) {
  for (const lang of ["en","pl","es","de","fr"]) {
    const p = path.join(root, "dist", browser, "_locales", lang, "messages.json");
    const messages = readJson(p);
    for (const key of ["extName","extDescription","protection","statusOn","statusOff"]) {
      if (!messages[key]?.message) fail(`${browser}/${lang}: missing ${key}`);
    }
  }
}

if (!process.exitCode) console.log(`OK: manifests, files, 5 locales and ${rules.length} DNR rules validated`);
