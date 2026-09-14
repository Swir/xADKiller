import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const fail = (message) => { console.error("FAIL:", message); process.exitCode = 1; };
const read = (rel) => fs.readFileSync(path.join(base, rel), "utf8");

for (const rel of [
  "temporary-site-guard.js",
  "titan-engine.js",
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
const popupHtml = read("popup.html");
const popupJs = read("popup.js");

if (!worker.includes('"temporary-site-guard.js"')) fail("temporary Breakage Guard is not imported by service-worker.js");
for (const token of ["xadTemporaryPauseSitesV1","xadTemporaryPauseInjectedAllowSitesV1","905000","905199","allowAllRequests","setTemporarySitePause","getTemporarySitePause"]) {
  if (!guard.includes(token)) fail(`temporary Breakage Guard missing ${token}`);
}
if (!guard.includes("allowSites")) fail("temporary Breakage Guard does not bridge content-layer allow state");
if (!titan.includes("xadTitanHostMemoryV1") || !titan.includes("resetTitanMemory") || !titan.includes("MEMORY_TTL_MS")) fail("Adaptive Memory engine incomplete");
if (!popupHtml.includes('id="tempPauseBtn"') || !popupHtml.includes('id="pauseBadge"') || !popupHtml.includes('id="resetMemoryBtn"')) fail("v1.5 popup controls incomplete");
if (!popupJs.includes("setTemporarySitePause") || !popupJs.includes("getTemporarySitePause") || !popupJs.includes("resetTitanMemory")) fail("v1.5 popup wiring incomplete");

for (const rel of ["temporary-site-guard.js","titan-engine.js","popup.js"]) {
  const code = read(rel);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) fail(`${rel}: dynamic code execution forbidden`);
  if (/importScripts\s*\(\s*["']https?:/i.test(code)) fail(`${rel}: remote hosted code forbidden`);
}

const localeRoot = path.join(base, "_locales");
const localeDirs = fs.readdirSync(localeRoot, { withFileTypes:true }).filter((x) => x.isDirectory()).map((x) => x.name).sort();
if (JSON.stringify(localeDirs) !== JSON.stringify(["en","pl"])) fail(`only en/pl locales allowed, found: ${localeDirs.join(",")}`);
for (const lang of ["en","pl"]) {
  const messages = JSON.parse(read(`_locales/${lang}/messages.json`));
  for (const key of ["pauseSite15","resumeSiteNow","pauseSiteHint","adaptiveMemory","resetMemory"]) {
    if (!messages[key]?.message) fail(`${lang}: missing ${key}`);
  }
}

if (!process.exitCode) console.log("OK: v1.5 Adaptive Memory + Breakage Guard safety invariants validated");
