import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const common = path.join(root, "common");
const out = path.join(root, "dist", "chrome");

const SOURCES = [
  { id: "easylist", mode: "standard", budget: 7000, cosmetic: true, url: "https://easylist.to/easylist/easylist.txt" },
  { id: "easyprivacy", mode: "standard", budget: 4500, cosmetic: true, url: "https://easylist.to/easylist/easyprivacy.txt" },
  { id: "adguard-base", mode: "standard", budget: 4500, cosmetic: true, url: "https://filters.adtidy.org/extension/chromium/filters/2.txt" },
  { id: "adguard-tracking", mode: "standard", budget: 2500, cosmetic: true, url: "https://filters.adtidy.org/extension/chromium/filters/3.txt" },
  { id: "hagezi-ultimate", mode: "ultra", budget: 9000, cosmetic: false, url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt" }
];

const ALL_TYPES = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"];
const TYPE_MAP = {
  script: "script", image: "image", stylesheet: "stylesheet", xhr: "xmlhttprequest",
  xmlhttprequest: "xmlhttprequest", subdocument: "sub_frame", frame: "sub_frame",
  media: "media", font: "font", ping: "ping", websocket: "websocket", other: "other",
  document: "main_frame"
};
const UNSUPPORTED = /^(redirect|redirect-rule|removeparam|csp|replace|urltransform|header|cookie|popup|popunder|permissions|webrtc|generichide|genericblock|elemhide|specifichide|badfilter)/i;
const GENERIC_HINT = /(\/ads?\/|adserver|adservice|advert|banner|sponsor|tracking|analytics|doubleclick|pagead|prebid|googlesyndication|promoted)/i;

function cleanDomain(v) {
  return String(v || "").trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
}
function validDomain(v) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(v);
}
function normalizeSelector(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 240) return "";
  if (/\{\}|\{.+\}|:style\(|:remove\(|:remove-attr\(|:xpath\(|\+js\(|##\^|#\$#|#\?#|#%#/i.test(s)) return "";
  return s;
}
function parseOptions(raw) {
  const condition = {};
  if (!raw) return { ok: true, condition: { resourceTypes: [...ALL_TYPES] } };
  const positives = [];
  const negatives = [];
  const initiators = [];
  const excludedInitiators = [];
  for (const piece0 of raw.split(",")) {
    const piece = piece0.trim();
    if (!piece) continue;
    if (UNSUPPORTED.test(piece)) return { ok: false };
    if (piece === "third-party" || piece === "3p") { condition.domainType = "thirdParty"; continue; }
    if (piece === "~third-party" || piece === "1p") { condition.domainType = "firstParty"; continue; }
    if (piece === "match-case") { condition.isUrlFilterCaseSensitive = true; continue; }
    if (piece === "important") continue;
    if (piece.startsWith("domain=")) {
      for (const d0 of piece.slice(7).split("|")) {
        const neg = d0.startsWith("~");
        const d = cleanDomain(neg ? d0.slice(1) : d0);
        if (!validDomain(d)) continue;
        (neg ? excludedInitiators : initiators).push(d);
      }
      continue;
    }
    const neg = piece.startsWith("~");
    const key = neg ? piece.slice(1) : piece;
    const mapped = TYPE_MAP[key];
    if (mapped) (neg ? negatives : positives).push(mapped);
  }

  // Chrome DNR rejects a condition when the same resource appears in both
  // resourceTypes and excludedResourceTypes. Compile exclusions into the
  // effective positive type set instead of emitting overlapping arrays.
  const negativeTypes = new Set(negatives);
  const baseTypes = positives.length ? [...new Set(positives)] : [...ALL_TYPES];
  const effectiveTypes = baseTypes.filter((type) => !negativeTypes.has(type));
  if (!effectiveTypes.length) return { ok: false };
  condition.resourceTypes = effectiveTypes;

  // Likewise, never emit the same initiator in include and exclude arrays.
  const excludedSet = new Set(excludedInitiators);
  const uniqueInitiators = [...new Set(initiators)].filter((d) => !excludedSet.has(d));
  if (initiators.length && !uniqueInitiators.length) return { ok: false };
  if (uniqueInitiators.length) condition.initiatorDomains = uniqueInitiators.slice(0, 100);
  if (excludedSet.size) condition.excludedInitiatorDomains = [...excludedSet].slice(0, 100);
  return { ok: true, condition };
}
function parseNetworkLine(line0) {
  let line = String(line0 || "").trim();
  if (!line || line.startsWith("!") || line.startsWith("[") || line.startsWith("#")) return null;
  if (line.includes("##") || line.includes("#@#") || line.includes("#$#") || line.includes("#?#") || line.includes("#%#")) return null;
  let action = "block";
  if (line.startsWith("@@")) { action = "allow"; line = line.slice(2); }
  if (line.startsWith("/")) return null;
  let pattern = line;
  let options = "";
  const dollar = line.indexOf("$");
  if (dollar >= 0) { pattern = line.slice(0, dollar); options = line.slice(dollar + 1); }
  pattern = pattern.trim();
  if (!pattern || pattern.length > 300 || /[^\x20-\x7E]/.test(pattern)) return null;
  const anchored = pattern.startsWith("||") || pattern.startsWith("|http://") || pattern.startsWith("|https://");
  if (!anchored && !GENERIC_HINT.test(pattern)) return null;
  if (!anchored && pattern.length < 6) return null;
  const parsed = parseOptions(options);
  if (!parsed.ok) return null;
  return { action, priority: action === "allow" ? 100 : 1, condition: { urlFilter: pattern, ...parsed.condition } };
}
function parseDomainLine(line0) {
  let s = String(line0 || "").trim();
  if (!s || s.startsWith("#") || s.startsWith("!")) return null;
  if (s.startsWith("||")) s = s.slice(2).split("^")[0].split("/")[0];
  s = cleanDomain(s.split(/[\s^/]/)[0]);
  if (!validDomain(s)) return null;
  return { action: "block", priority: 1, condition: { urlFilter: `||${s}^`, resourceTypes: [...ALL_TYPES] } };
}
function addRule(target, seen, parsed) {
  if (!parsed) return false;
  const key = JSON.stringify(parsed);
  if (seen.has(key)) return false;
  seen.add(key);
  target.push(parsed);
  return true;
}
function parseCosmeticLine(line, generic, scoped) {
  if (!line || line.startsWith("!") || line.includes("#@#")) return;
  const idx = line.indexOf("##");
  if (idx < 0) return;
  const left = line.slice(0, idx).trim();
  const selector = normalizeSelector(line.slice(idx + 2));
  if (!selector) return;
  if (!left) {
    if (generic.size < 4500) generic.add(selector);
    return;
  }
  const domains = left.split(",").map(cleanDomain).filter((d) => validDomain(d) && !d.startsWith("~")).slice(0, 8);
  for (const d of domains) {
    if (scoped.size >= 3000 && !scoped.has(d)) break;
    if (!scoped.has(d)) scoped.set(d, new Set());
    const set = scoped.get(d);
    if (set.size < 50) set.add(selector);
  }
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "xADKiller-Chrome/1.1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
function materialize(rawRules, startId = 1) {
  return rawRules.map((r, i) => ({ id: startId + i, priority: r.priority, action: { type: r.action }, condition: r.condition }));
}

const standard = [];
const ultra = [];
const standardSeen = new Set();
const ultraSeen = new Set();
const genericSelectors = new Set();
const scopedSelectors = new Map();
const sourceStatus = [];

const localDomains = fs.readFileSync(path.join(common, "rules", "domains.txt"), "utf8").split(/\r?\n/);
for (const line of localDomains) addRule(standard, standardSeen, parseDomainLine(line));

for (const source of SOURCES) {
  try {
    const text = await fetchText(source.url);
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

    // Cosmetic rules must be scanned across the WHOLE source. Network budgets must
    // never stop us before EasyList/AdGuard cosmetic sections are reached.
    if (source.cosmetic) {
      for (const line of lines) parseCosmeticLine(line, genericSelectors, scopedSelectors);
    }

    let added = 0;
    for (const line of lines) {
      const parsed = source.id === "hagezi-ultimate" ? parseDomainLine(line) : parseNetworkLine(line);
      if (!parsed) continue;
      const target = source.mode === "ultra" ? ultra : standard;
      const seen = source.mode === "ultra" ? ultraSeen : standardSeen;
      if (addRule(target, seen, parsed)) added++;
      if (added >= source.budget) break;
    }
    sourceStatus.push({ id: source.id, ok: true, added });
  } catch (error) {
    sourceStatus.push({ id: source.id, ok: false, error: String(error?.message || error) });
  }
}

if (standard.length < 1000) throw new Error(`Too few STANDARD rules: ${standard.length}`);
if (ultra.length < 1000) throw new Error(`Too few ULTRA rules: ${ultra.length}`);
if (!sourceStatus.some((s) => s.id === "easylist" && s.ok)) throw new Error("EasyList unavailable");
if (genericSelectors.size < 250) throw new Error(`Too few generic cosmetic selectors: ${genericSelectors.size}`);
if (scopedSelectors.size < 50) throw new Error(`Too few scoped cosmetic domains: ${scopedSelectors.size}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(common, out, { recursive: true });
fs.mkdirSync(path.join(out, "rules"), { recursive: true });
fs.rmSync(path.join(out, "rules", "domains.txt"), { force: true });
fs.writeFileSync(path.join(out, "rules", "standard.json"), JSON.stringify(materialize(standard), null, 2));
fs.writeFileSync(path.join(out, "rules", "ultra.json"), JSON.stringify(materialize(ultra), null, 2));
fs.copyFileSync(path.join(root, "chrome", "manifest.json"), path.join(out, "manifest.json"));

const cosmeticData = {
  generic: [...genericSelectors],
  scoped: [...scopedSelectors.entries()].map(([domain, set]) => [domain, [...set]]),
  meta: { generic: genericSelectors.size, scopedDomains: scopedSelectors.size }
};
fs.writeFileSync(path.join(out, "cosmetic-data.js"), `globalThis.XAD_COSMETIC_DATA=${JSON.stringify(cosmeticData)};\n`);
const buildMeta = {
  version: "1.1.0",
  builtAt: new Date().toISOString(),
  standardRules: standard.length,
  ultraRules: ultra.length,
  cosmeticGeneric: genericSelectors.size,
  cosmeticDomains: scopedSelectors.size,
  sources: sourceStatus
};
fs.writeFileSync(path.join(out, "build-meta.js"), `self.XAD_BUILD_META=${JSON.stringify(buildMeta)};\n`);
console.log(JSON.stringify(buildMeta, null, 2));
