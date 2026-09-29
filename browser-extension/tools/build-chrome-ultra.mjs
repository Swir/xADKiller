import fs from "node:fs";
import path from "node:path";
import {
  agreementSummary,
  qualityBoost,
  registerSourceAgreement,
  sourceAgreementCount
} from "./rule-quality.mjs";

const root = path.resolve(import.meta.dirname, "..");
const common = path.join(root, "common");
const out = path.join(root, "dist", "chrome");

const SOURCES = [
  { id: "easylist", mode: "standard", budget: 7400, cosmetic: true, url: "https://easylist.to/easylist/easylist.txt" },
  { id: "easyprivacy", mode: "standard", budget: 4700, cosmetic: true, url: "https://easylist.to/easylist/easyprivacy.txt" },
  { id: "adguard-base", mode: "standard", budget: 4600, cosmetic: true, url: "https://filters.adtidy.org/extension/chromium/filters/2.txt" },
  { id: "adguard-tracking", mode: "standard", budget: 2800, cosmetic: true, url: "https://filters.adtidy.org/extension/chromium/filters/3.txt" },
  { id: "hagezi-ultimate", mode: "ultra", budget: 10000, cosmetic: false, url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt" }
];

const STANDARD_CAP = 19700;
const ULTRA_CAP = 10000;
const COMPAT_CAP = 8000;
const ALL_TYPES = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"];
const TYPE_MAP = {
  script: "script", image: "image", stylesheet: "stylesheet", xhr: "xmlhttprequest",
  xmlhttprequest: "xmlhttprequest", subdocument: "sub_frame", frame: "sub_frame",
  media: "media", font: "font", ping: "ping", websocket: "websocket", other: "other",
  document: "main_frame"
};
const UNSUPPORTED = /^(redirect|redirect-rule|removeparam|csp|replace|urltransform|header|cookie|popup|popunder|permissions|webrtc|generichide|genericblock|elemhide|specifichide|badfilter)/i;
const STRONG_HINT = /(\/ads?(?:[._\/-]|$)|adserver|adservice|adrequest|advert|banner|sponsor|promot|tracking|tracker|analytics|telemetr|metric|pixel|beacon|doubleclick|pagead|gampad|securepubads|prebid|googlesyndication|googleadservices|taboola|outbrain|criteo|adnxs|adsrvr|pubmatic|rubicon|hotjar|mouseflow|sentry|bugsnag)/i;
const SCRIPT_HINT = /(\.js(?:[?&#]|$)|script|prebid|pagead|adsbygoogle|gpt|gampad|ima3)/i;

function cleanDomain(v) {
  return String(v || "").trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
}
function validDomain(v) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(v) && !v.includes("..");
}
function normalizeSelector(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 260) return "";
  if (/\{\}|\{.+\}|:style\(|:remove\(|:remove-attr\(|:xpath\(|\+js\(|##\^|#\$#|#\?#|#%#/i.test(s)) return "";
  return s;
}
function validDnrUrlFilter(pattern) {
  if (!pattern || pattern.length > 300 || /[^\x21-\x7E]/.test(pattern)) return false;
  if (pattern.startsWith("||*")) return false;
  let body = pattern;
  if (body.startsWith("||")) {
    body = body.slice(2);
    if (!/^[a-z0-9]/i.test(body)) return false;
  } else if (body.startsWith("|")) {
    body = body.slice(1);
  }
  if (body.endsWith("|")) body = body.slice(0, -1);
  if (!body || body.includes("|")) return false;
  return true;
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
  const negativeTypes = new Set(negatives);
  const baseTypes = positives.length ? [...new Set(positives)] : [...ALL_TYPES];
  const effectiveTypes = baseTypes.filter((type) => !negativeTypes.has(type));
  if (!effectiveTypes.length) return { ok: false };
  condition.resourceTypes = effectiveTypes;
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
  let pattern = line;
  let options = "";
  const dollar = line.indexOf("$");
  if (dollar >= 0) { pattern = line.slice(0, dollar); options = line.slice(dollar + 1); }
  pattern = pattern.trim();
  // ABP regex uses /.../. A normal substring such as /ads.js must survive.
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) return null;
  if (!validDnrUrlFilter(pattern)) return null;
  const anchored = pattern.startsWith("||") || pattern.startsWith("|http://") || pattern.startsWith("|https://");
  if (!anchored && !STRONG_HINT.test(pattern)) return null;
  if (!anchored && pattern.length < 5) return null;
  const parsed = parseOptions(options);
  if (!parsed.ok) return null;
  return { action, priority: action === "allow" ? 100 : 1, condition: { urlFilter: pattern, ...parsed.condition } };
}
function parseDomainLine(line0) {
  let s = String(line0 || "").trim();
  if (!s || s.startsWith("#") || s.startsWith("!") || s.startsWith("@@")) return null;
  if (s.startsWith("||")) s = s.slice(2).split("^")[0].split("/")[0];
  s = cleanDomain(s.split(/[\s^/]/)[0]);
  if (!validDomain(s)) return null;
  return { action: "block", priority: 1, condition: { urlFilter: `||${s}^`, resourceTypes: [...ALL_TYPES] } };
}
function parseThirdPartyDomainLine(line0) {
  const parsed = parseDomainLine(line0);
  if (!parsed) return null;
  return {
    ...parsed,
    priority: 5,
    condition: { ...parsed.condition, domainType: "thirdParty" }
  };
}
function ruleKey(parsed) { return JSON.stringify(parsed); }
function ruleScore(parsed) {
  if (!parsed) return -999;
  const filter = parsed.condition?.urlFilter || "";
  let score = parsed.action === "allow" ? 140 : 0;
  if (STRONG_HINT.test(filter)) score += 90;
  if (SCRIPT_HINT.test(filter)) score += 18;
  if (filter.startsWith("/") && !filter.startsWith("//")) score += 24;
  if (!filter.startsWith("||")) score += 20;
  if (parsed.condition?.domainType === "thirdParty") score += 12;
  if (parsed.condition?.domainType === "firstParty") score += 18;
  if (parsed.condition?.resourceTypes?.includes("script")) score += 8;
  if (parsed.condition?.resourceTypes?.includes("xmlhttprequest")) score += 8;
  if (parsed.condition?.initiatorDomains?.length) score += 10;
  score += Math.min(12, Math.floor(filter.length / 24));
  return score;
}
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function selectBest(parsedRules, budget, agreementMap = null) {
  const map = new Map();
  for (const parsed of parsedRules) {
    if (!parsed) continue;
    const key = ruleKey(parsed);
    const agreement = agreementMap ? sourceAgreementCount(agreementMap, parsed) : 1;
    const score = ruleScore(parsed) + (agreementMap ? qualityBoost(parsed, agreement) : 0);
    const old = map.get(key);
    if (!old || score > old.score) map.set(key, { parsed, score, hash: fnv1a(key) });
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.hash - b.hash)
    .slice(0, budget)
    .map((x) => x.parsed);
}
function addRules(target, seen, rules, cap, maxAdds = Number.POSITIVE_INFINITY) {
  let added = 0;
  for (const parsed of rules) {
    if (!parsed) continue;
    if (target.length >= cap || added >= maxAdds) break;
    const key = ruleKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(parsed);
    added++;
  }
  return added;
}
function parseCosmeticLine(line, generic, scoped) {
  if (!line || line.startsWith("!") || line.includes("#@#")) return;
  const idx = line.indexOf("##");
  if (idx < 0) return;
  const left = line.slice(0, idx).trim();
  const selector = normalizeSelector(line.slice(idx + 2));
  if (!selector) return;
  if (!left) {
    if (generic.size < 5500) generic.add(selector);
    return;
  }
  const domains = left.split(",").map(cleanDomain).filter((d) => validDomain(d) && !d.startsWith("~")).slice(0, 8);
  for (const d of domains) {
    if (scoped.size >= 3500 && !scoped.has(d)) break;
    if (!scoped.has(d)) scoped.set(d, new Set());
    const set = scoped.get(d);
    if (set.size < 50) set.add(selector);
  }
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "xADKiller-Chrome/1.4.0-TITAN" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
function materialize(rawRules, startId = 1) {
  return rawRules.filter(Boolean).map((r, i) => ({ id: startId + i, priority: r.priority, action: { type: r.action }, condition: r.condition }));
}

const standard = [];
const ultra = [];
const compatCandidates = [];
const standardSeen = new Set();
const ultraSeen = new Set();
const genericSelectors = new Set();
const scopedSelectors = new Map();
const sourceStatus = [];
const standardAgreement = new Map();
const standardBatches = [];

const localDomains = fs.readFileSync(path.join(common, "rules", "domains.txt"), "utf8").split(/\r?\n/);
addRules(standard, standardSeen, localDomains.map(parseDomainLine), STANDARD_CAP);

const screenshotStandardThirdParty = fs.readFileSync(path.join(common, "rules", "screenshot-standard-third-party.txt"), "utf8").split(/\r?\n/);
const screenshotUltraThirdParty = fs.readFileSync(path.join(common, "rules", "screenshot-ultra-third-party.txt"), "utf8").split(/\r?\n/);
addRules(standard, standardSeen, screenshotStandardThirdParty.map(parseThirdPartyDomainLine), STANDARD_CAP);
addRules(ultra, ultraSeen, screenshotUltraThirdParty.map(parseThirdPartyDomainLine), ULTRA_CAP);

for (const source of SOURCES) {
  try {
    const text = await fetchText(source.url);
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (source.cosmetic) for (const line of lines) parseCosmeticLine(line, genericSelectors, scopedSelectors);
    const parsed = lines.map((line) => source.id === "hagezi-ultimate" ? parseDomainLine(line) : parseNetworkLine(line)).filter(Boolean);

    if (source.mode === "standard") {
      const blocks = parsed.filter((r) => r.action === "block");
      const allows = parsed.filter((r) => r.action === "allow");
      compatCandidates.push(...allows);
      for (const rule of blocks) registerSourceAgreement(standardAgreement, rule, source.id);
      const status = { id: source.id, ok: true, parsed: parsed.length, blockCandidates: blocks.length, allowCandidates: allows.length, selected: 0, added: 0 };
      sourceStatus.push(status);
      standardBatches.push({ source, blocks, status });
    } else {
      const blocks = parsed.filter((r) => r.action === "block");
      const best = selectBest(blocks, source.budget);
      const added = addRules(ultra, ultraSeen, best, ULTRA_CAP);
      sourceStatus.push({ id: source.id, ok: true, parsed: parsed.length, blockCandidates: blocks.length, allowCandidates: 0, selected: best.length, added });
    }
  } catch (error) {
    sourceStatus.push({ id: source.id, ok: false, error: String(error?.message || error) });
  }
}

// Rank each source by the shared quality model, then walk beyond overlapping
// top rules until that source contributes its intended number of unique rules.
// This preserves source diversity/budget while still preferring cross-source
// agreement and useful request-type coverage at every selection point.
for (const batch of standardBatches) {
  const ranked = selectBest(batch.blocks, batch.blocks.length, standardAgreement);
  const added = addRules(standard, standardSeen, ranked, STANDARD_CAP, batch.source.budget);
  batch.status.selected = Math.min(batch.source.budget, ranked.length);
  batch.status.added = added;
}

const qualityRanking = agreementSummary(standardAgreement);
const compat = selectBest(compatCandidates, COMPAT_CAP);

if (standard.length < 15000) throw new Error(`Too few STANDARD block rules: ${standard.length}`);
if (ultra.length < 7000) throw new Error(`Too few ULTRA block rules: ${ultra.length}`);
if (compat.length < 1000) throw new Error(`Too few COMPAT exception rules: ${compat.length}`);
if (standard.length + ultra.length > 29850) throw new Error(`ULTRA static rule budget exceeded: ${standard.length + ultra.length}`);
if (standard.length + compat.length > 29850) throw new Error(`STANDARD+COMPAT static rule budget exceeded: ${standard.length + compat.length}`);
if (standard.some((r) => r.action !== "block")) throw new Error("STANDARD contains non-block actions");
if (ultra.some((r) => r.action !== "block")) throw new Error("ULTRA contains non-block actions");
if (compat.some((r) => r.action !== "allow")) throw new Error("COMPAT contains non-allow actions");
if (!sourceStatus.some((s) => s.id === "easylist" && s.ok)) throw new Error("EasyList unavailable");
if (genericSelectors.size < 500) throw new Error(`Too few generic cosmetic selectors: ${genericSelectors.size}`);
if (scopedSelectors.size < 100) throw new Error(`Too few scoped cosmetic domains: ${scopedSelectors.size}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(common, out, { recursive: true });
fs.mkdirSync(path.join(out, "rules"), { recursive: true });
fs.rmSync(path.join(out, "rules", "domains.txt"), { force: true });
fs.writeFileSync(path.join(out, "rules", "standard.json"), JSON.stringify(materialize(standard), null, 2));
fs.writeFileSync(path.join(out, "rules", "ultra.json"), JSON.stringify(materialize(ultra), null, 2));
fs.writeFileSync(path.join(out, "rules", "compat.json"), JSON.stringify(materialize(compat), null, 2));
fs.copyFileSync(path.join(root, "chrome", "manifest.json"), path.join(out, "manifest.json"));

const cosmeticData = {
  generic: [...genericSelectors],
  scoped: [...scopedSelectors.entries()].map(([domain, set]) => [domain, [...set]]),
  meta: { generic: genericSelectors.size, scopedDomains: scopedSelectors.size }
};
fs.writeFileSync(path.join(out, "cosmetic-data.js"), `globalThis.XAD_COSMETIC_DATA=${JSON.stringify(cosmeticData)};\n`);
const buildMeta = {
  version: "1.4.0",
  builtAt: new Date().toISOString(),
  standardRules: standard.length,
  ultraRules: ultra.length,
  compatRules: compat.length,
  cosmeticGeneric: genericSelectors.size,
  cosmeticDomains: scopedSelectors.size,
  standardQualityRanking: {
    model: "source-agreement+resource-coverage-v1",
    ...qualityRanking
  },
  sources: sourceStatus
};
fs.writeFileSync(path.join(out, "build-meta.js"), `self.XAD_BUILD_META=${JSON.stringify(buildMeta)};\n`);
console.log(JSON.stringify(buildMeta, null, 2));
