import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const rulesDir = path.join(out, "rules");

const SOURCES = [
  {
    id: "hagezi-ultimate",
    url: "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt",
    quota: 10000
  },
  {
    id: "adguard-dns",
    url: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt",
    quota: 9000
  },
  {
    id: "stevenblack",
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
    quota: 5000
  }
];

const HIGH_VALUE = /(ads?|advert|banner|sponsor|promot|track|telemetr|analytics|metric|pixel|beacon|marketing|affiliate|doubleclick|googlesyndication|adservice|adserver|prebid|taboola|outbrain|criteo|adnxs|adsrvr|pubmatic|rubicon|hotjar|mouseflow|luckyorange|sentry|bugsnag|facebook|twitter|linkedin|pinterest|reddit|tiktok|yandex|yahoo|unity|xiaomi|samsung|huawei|oppo|realme|oneplus)/i;

function cleanDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/^\.+|\.+$/g, "");
}

function validDomain(domain) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domain)
    && !domain.includes("..")
    && !domain.endsWith(".local")
    && !domain.endsWith(".localhost");
}

function parseDomain(line0) {
  let line = String(line0 || "").trim();
  if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("[") || line.startsWith("@@")) return "";

  if (line.startsWith("||")) {
    line = line.slice(2);
    line = line.split("^")[0].split("$")[0].split("/")[0];
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
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function selectBalanced(domains, quota) {
  const unique = [...new Set(domains)].filter(validDomain);
  const priority = [];
  const rest = [];
  for (const domain of unique) {
    (HIGH_VALUE.test(domain) ? priority : rest).push(domain);
  }
  priority.sort((a, b) => fnv1a(a) - fnv1a(b));
  rest.sort((a, b) => fnv1a(a) - fnv1a(b));

  const priorityBudget = Math.min(priority.length, Math.floor(quota * 0.45));
  const selected = priority.slice(0, priorityBudget);
  const remaining = quota - selected.length;
  selected.push(...rest.slice(0, remaining));
  if (selected.length < quota) selected.push(...priority.slice(priorityBudget, priorityBudget + (quota - selected.length)));
  return selected.slice(0, quota);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "xADKiller-Chrome/1.2.0 DynamicIntel" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
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

fs.mkdirSync(rulesDir, { recursive: true });
const staticDomains = collectStaticDomains();
const final = [];
const finalSet = new Set();
const status = [];

for (const source of SOURCES) {
  try {
    const text = await fetchText(source.url);
    const parsed = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(parseDomain).filter(Boolean);
    const selected = selectBalanced(parsed.filter((d) => !staticDomains.has(d) && !finalSet.has(d)), source.quota);
    for (const domain of selected) {
      if (finalSet.has(domain)) continue;
      finalSet.add(domain);
      final.push(domain);
    }
    status.push({ id: source.id, ok: true, parsed: new Set(parsed).size, added: selected.length });
  } catch (error) {
    status.push({ id: source.id, ok: false, error: String(error?.message || error) });
  }
}

if (final.length < 18000) throw new Error(`Too few dynamic intelligence domains: ${final.length}`);

const capped = final.slice(0, 24000);
fs.writeFileSync(path.join(rulesDir, "dynamic-intel.json"), JSON.stringify(capped));
fs.writeFileSync(path.join(out, "dynamic-intel-meta.json"), JSON.stringify({
  version: "1.2.0",
  domains: capped.length,
  sources: status
}, null, 2));

console.log(JSON.stringify({ dynamicIntelDomains: capped.length, sources: status }, null, 2));
