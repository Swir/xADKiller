import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (message) => { console.error("FAIL:", message); process.exitCode = 1; };
const read = (rel) => fs.readFileSync(path.join(base, rel), "utf8");

for (const rel of [
  "temporary-site-guard.js",
  "titan-engine.js",
  "feed-transport-guard.js",
  "feed-rollback-provenance.js",
  "feed-guard.js",
  "feed-cache-integrity.js",
  "feed-health-ui.js",
  "service-worker.js",
  "popup.html",
  "popup.js",
  "_locales/en/messages.json",
  "_locales/pl/messages.json"
]) {
  if (!fs.existsSync(path.join(base, rel))) fail(`missing v1.5 safety file ${rel}`);
}

const worker = read("service-worker.js");
const guard = read("temporary-site-guard.js");
const titan = read("titan-engine.js");
const feedTransport = read("feed-transport-guard.js");
const rollbackGuard = read("feed-rollback-provenance.js");
const feedGuard = read("feed-guard.js");
const cacheIntegrity = read("feed-cache-integrity.js");
const feedUi = read("feed-health-ui.js");
const popupHtml = read("popup.html");
const popupJs = read("popup.js");

if (!worker.includes('"feed-transport-guard.js"') || worker.indexOf('"feed-transport-guard.js"') > worker.indexOf('"feed-guard.js"')) fail("Feed transport guard must load before Feed Guard");
if (!worker.includes('"feed-rollback-provenance.js"') || worker.indexOf('"feed-rollback-provenance.js"') > worker.indexOf('"feed-guard.js"')) fail("Rollback provenance guard must load before Feed Guard");
if (!worker.includes('"feed-guard.js"') || worker.indexOf('"feed-guard.js"') > worker.indexOf('"background.js"')) fail("Feed Guard must load before network feed consumers");
if (!worker.includes('"feed-cache-integrity.js"') || worker.indexOf('"feed-cache-integrity.js"') > worker.indexOf('"background.js"')) fail("Feed cache integrity guard must load before feed consumers");
if (!worker.includes('"temporary-site-guard.js"')) fail("temporary Breakage Guard is not imported by service-worker.js");
for (const token of ["redirect:\"error\"","credentials:\"omit\"","referrerPolicy:\"no-referrer\"","transport_provenance","content_length","payload_size"]) {
  if (!feedTransport.includes(token)) fail(`Feed transport hardening missing ${token}`);
}
for (const token of ["APPROVED_ROLLBACK_REFS","rollback_provenance","live-shield-feed/browser-intelligence/xadkiller-live-shield.json","main/browser-intelligence/xadkiller-titan-feed.json"]) {
  if (!rollbackGuard.includes(token)) fail(`Feed rollback provenance hardening missing ${token}`);
}
for (const token of ["xadTemporaryPauseSitesV1","xadTemporaryPauseInjectedAllowSitesV1","905000","905199","allowAllRequests","setTemporarySitePause","getTemporarySitePause"]) {
  if (!guard.includes(token)) fail(`temporary Breakage Guard missing ${token}`);
}
if (!guard.includes("allowSites")) fail("temporary Breakage Guard does not bridge content-layer allow state");
if (!titan.includes("xadTitanHostMemoryV1") || !titan.includes("resetTitanMemory") || !titan.includes("MEMORY_TTL_MS")) fail("Adaptive Memory engine incomplete");
for (const token of ["xadFeedGuardHealthV1","getFeedGuardHealth","consecutiveFailures","lastVersion","lastError"]) {
  if (!feedGuard.includes(token)) fail(`Feed Guard health diagnostics missing ${token}`);
}
for (const token of ["SHA-256","xadCacheDigestLiveShieldV1","xadCacheDigestLiveMatrixV1","xadCacheDigestTitanV1","subtle.digest","callRemove(purge)"]) {
  if (!cacheIntegrity.includes(token)) fail(`Feed cache integrity hardening missing ${token}`);
}
for (const token of ["getFeedGuardHealth","feedHealthBadge","DEGRADED","Cached protection remains active"]) {
  if (!feedUi.includes(token)) fail(`Feed Guard UI missing ${token}`);
}
if (!popupHtml.includes('id="tempPauseBtn"') || !popupHtml.includes('id="pauseBadge"') || !popupHtml.includes('id="resetMemoryBtn"')) fail("v1.5 popup controls incomplete");
if (!popupHtml.includes('id="feedHealthBadge"') || !popupHtml.includes('src="feed-health-ui.js"')) fail("Feed Guard health card is not wired into popup");
if (!popupJs.includes("setTemporarySitePause") || !popupJs.includes("getTemporarySitePause") || !popupJs.includes("resetTitanMemory")) fail("v1.5 popup wiring incomplete");

for (const rel of ["temporary-site-guard.js","titan-engine.js","feed-transport-guard.js","feed-rollback-provenance.js","feed-guard.js","feed-cache-integrity.js","feed-health-ui.js","popup.js"]) {
  const code = read(rel);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) fail(`${rel}: dynamic code execution forbidden`);
  if (/importScripts\s*\(\s*["']https?:/i.test(code)) fail(`${rel}: remote hosted code forbidden`);
  if (/<script[^>]+src=["']https?:/i.test(code)) fail(`${rel}: remote script reference forbidden`);
}

const localeRoot = path.join(base, "_locales");
const localeDirs = fs.readdirSync(localeRoot, { withFileTypes:true }).filter((x) => x.isDirectory()).map((x) => x.name).sort();
if (JSON.stringify(localeDirs) !== JSON.stringify(["en","pl"])) fail(`only en/pl locales allowed, found: ${localeDirs.join(",")}`);
for (const lang of ["en","pl"]) {
  const messages = JSON.parse(read(`_locales/${lang}/messages.json`));
  for (const key of ["pauseSite15","resumeSiteNow","pauseSiteHint","adaptiveMemory","resetMemory","feedIntegrity","feedHealthWaiting","feedIntegrityHint"]) {
    if (!messages[key]?.message) fail(`${lang}: missing ${key}`);
  }
}

if (!process.exitCode) console.log("OK: v1.5 Adaptive Memory + Breakage Guard + Feed transport/rollback/cache integrity/validation safety invariants validated");
