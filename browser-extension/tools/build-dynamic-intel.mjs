import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const rulesDir = path.join(out, "rules");

const SOURCES = [
  { id: "hagezi-ultimate", weight: 4, url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt" },
  { id: "adguard-dns", weight: 5, url: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt" },
  { id: "stevenblack", weight: 3, url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" }
];

const LIMIT = 24000;
const HIGH_VALUE = /(ads?|advert|banner|sponsor|promot|track|telemetr|analytics|metric|pixel|beacon|marketing|affiliate|doubleclick|googlesyndication|googleadservices|adservice|adserver|pagead|gampad|securepubads|prebid|taboola|outbrain|criteo|adnxs|adsrvr|pubmatic|rubicon|hotjar|mouseflow|luckyorange|fullstory|logrocket|sentry|bugsnag|facebook|twitter|linkedin|pinterest|reddit|tiktok|yandex|yahoo|unity|xiaomi|samsung|huawei|oppo|realme|oneplus|appsflyer|adjust|branch|kochava)/i;
const VERY_HIGH = /(doubleclick|googlesyndication|googleadservices|amazon-adsystem|adnxs|adsrvr|pubmatic|rubiconproject|criteo|taboola|outbrain|smartadserver|adform|pagead|gampad|securepubads|prebid|hotjar|mouseflow|sentry|bugsnag|unityads|samsungads|xiaomi|huawei|oppomobile)/i;

function cleanDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
}
function validDomain(domain) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domain)
    && !domain.includes("..") && !domain.endsWith(".local") && !domain.endsWith(".localhost");
}
function parseDomain(line0) {
  let line = String(line0 || "").trim();
  if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("[") || line.startsWith("@@")) return "";
  if (line.startsWith("||")) {
    line = line.slice(2).split("^")[0].split("$")[0].split("/")[0];
    const domain = cleanDomain(line);
    return validDomain(domain) ? domain : "";
  }
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)$/i.test(parts[0])) {
    const domain = cleanDomain(parts[1]);
    return validDomain(domain) ? domain : "";
  }
  const first = cleanDomain(parts[0]?.split(/[\^/$]/)[0] || "");
  return validDomain(first) ? first : "";
}
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "xADKiller-Chrome/1.4.0-TITAN" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function collectStaticDomains() {
  const set = new Set();
  for (const name of ["standard", "ultra"]) {
    const file = path.join(rulesDir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const rules = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const rule of rules) {
      const filter = String(rule?.condition?.urlFilter || "");
      const match = filter.match(/^\|\|([a-z0-9.-]+)\^?$/i);
      if (match && validDomain(match[1])) set.add(match[1].toLowerCase());
      for (const domain of rule?.condition?.requestDomains || []) if (validDomain(domain)) set.add(domain.toLowerCase());
    }
  }
  return set;
}
function bucket(domain) {
  const p = domain.split(".");
  if (p.length <= 2) return domain;
  const tail2 = p.slice(-2).join(".");
  if (/^(?:co|com|net|org|gov|edu)\.[a-z]{2}$/i.test(tail2) && p.length >= 3) return p.slice(-3).join(".");
  return tail2;
}

fs.mkdirSync(rulesDir, { recursive: true });
const staticDomains = collectStaticDomains();
const domainMeta = new Map();
const status = [];

for (const source of SOURCES) {
  try {
    const text = await fetchText(source.url);
    const unique = new Set(text.replace(/^\uFEFF/, "").split(/\r?\n/).map(parseDomain).filter(Boolean));
    for (const domain of unique) {
      if (staticDomains.has(domain)) continue;
      if (!domainMeta.has(domain)) domainMeta.set(domain, { domain, sources: new Set(), weight: 0 });
      const meta = domainMeta.get(domain);
      meta.sources.add(source.id);
      meta.weight += source.weight;
    }
    status.push({ id: source.id, ok: true, parsed: unique.size });
  } catch (error) {
    status.push({ id: source.id, ok: false, error: String(error?.message || error) });
  }
}

const ranked = [...domainMeta.values()].map((meta) => {
  let score = meta.weight * 30 + meta.sources.size * 80;
  if (HIGH_VALUE.test(meta.domain)) score += 100;
  if (VERY_HIGH.test(meta.domain)) score += 120;
  const labels = meta.domain.split(".").length;
  if (labels <= 3) score += 18;
  return { ...meta, score, hash: fnv1a(meta.domain) };
}).sort((a, b) => b.score - a.score || a.hash - b.hash);

const selected = [];
const selectedSet = new Set();
const bucketCounts = new Map();
function take(item, cap) {
  if (selectedSet.has(item.domain)) return false;
  const key = bucket(item.domain);
  const count = bucketCounts.get(key) || 0;
  if (count >= cap) return false;
  selectedSet.add(item.domain);
  selected.push(item.domain);
  bucketCounts.set(key, count + 1);
  return true;
}

// Phase 1: strongest consensus/high-value intelligence with diversity.
for (const item of ranked) {
  if (selected.length >= LIMIT) break;
  if (item.sources.size >= 2 || HIGH_VALUE.test(item.domain)) take(item, 30);
}
// Phase 2: fill remaining quota from the best single-source candidates.
for (const item of ranked) {
  if (selected.length >= LIMIT) break;
  take(item, 45);
}

if (selected.length < 18000) throw new Error(`Too few dynamic intelligence domains: ${selected.length}`);
const capped = selected.slice(0, LIMIT);
fs.writeFileSync(path.join(rulesDir, "dynamic-intel.json"), JSON.stringify(capped));
fs.writeFileSync(path.join(out, "dynamic-intel-meta.json"), JSON.stringify({
  version: "1.4.0",
  strategy: "weighted-consensus-diversity",
  domains: capped.length,
  candidates: domainMeta.size,
  sources: status
}, null, 2));
console.log(JSON.stringify({ dynamicIntelDomains: capped.length, candidates: domainMeta.size, strategy: "weighted-consensus-diversity", sources: status }, null, 2));
