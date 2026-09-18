(() => {
  if (globalThis.__xadNetworkScoutV1) return;
  globalThis.__xadNetworkScoutV1 = true;

  const RECOVERY_KEY = "xadHeuristicRecoverySitesV1";
  const STRONG_HOST_SUFFIXES = Object.freeze([
    "doubleclick.net","googlesyndication.com","googleadservices.com","amazon-adsystem.com",
    "adnxs.com","adsrvr.org","pubmatic.com","rubiconproject.com","criteo.com","criteo.net",
    "taboola.com","outbrain.com","smartadserver.com","smartadserver.net","adform.com","adform.net",
    "hotjar.com","hotjar.io","mouseflow.com","luckyorange.com","fullstory.com","logrocket.com",
    "appsflyer.com","adjust.com","branch.io","kochava.com","unityads.unity3d.com","samsungads.com",
    "ad.xiaomi.com","ads.huawei.com","adsfs.oppomobile.com","ads.oppomobile.com","ads.heytapmobi.com"
  ]);
  const STRONG_PATH = /\/(?:ads?|adserver|adservice|adrequest|pagead|gampad|securepubads|prebid|vast|vmap|ima3|commercial|sponsor|sponsored|promoted)(?:[._\/-]|$)/i;
  const STRONG_QUERY = /(?:^|[?&])(?:ad_unit|adunit|ad_slot|adslot|gdfp_req|iu|campaign|impression)=/i;
  const LOCAL_SUFFIXES = [".local", ".localhost", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"];
  const RESERVED_SUFFIXES = [".test", ".example", ".invalid"];
  const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain"]);
  const seen = new Set();
  let enabled = true;
  let mode = "standard";
  let allowSites = [];
  let heuristicRecoverySites = {};
  let sent = 0;

  function normalizeHost(v) { return String(v || "").trim().toLowerCase().replace(/^\.+|\.+$/g, ""); }
  function isIpv4Literal(host) {
    const parts = String(host || "").split(".");
    return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }
  function learningHostAllowed(value) {
    const host = normalizeHost(value);
    if (!host || host.length > 253 || !host.includes(".") || host.includes("..") || !/^[a-z0-9.-]+$/.test(host)) return false;
    if (isIpv4Literal(host) || host.includes(":") || host.startsWith("[") || host.endsWith("]") || LOCAL_NAMES.has(host)) return false;
    return !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
      && !RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  }
  function strongProviderHost(value) {
    const host = normalizeHost(value);
    return !!host && STRONG_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith("." + suffix));
  }
  function allowed() {
    const host = normalizeHost(location.hostname);
    return allowSites.some((entry) => {
      const d = normalizeHost(entry);
      return d && (host === d || host.endsWith("." + d));
    });
  }
  function recovered(now = Date.now()) {
    const host = normalizeHost(location.hostname);
    if (!host || !heuristicRecoverySites || typeof heuristicRecoverySites !== "object") return false;
    return Object.entries(heuristicRecoverySites).some(([entry, rawUntil]) => {
      const d = normalizeHost(entry);
      const until = Number(rawUntil || 0);
      return d && Number.isFinite(until) && until > now && (host === d || host.endsWith("." + d));
    });
  }
  function active() {
    return enabled && mode === "ultra" && learningHostAllowed(location.hostname) && !allowed() && !recovered();
  }
  function sameSite(a, b) {
    a = normalizeHost(a); b = normalizeHost(b);
    return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
  }
  function worthy(raw) {
    let u;
    try { u = new URL(String(raw || ""), location.href); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (!learningHostAllowed(location.hostname) || !learningHostAllowed(u.hostname)) return false;
    const own = sameSite(u.hostname, location.hostname);
    const pathQuery = `${u.pathname}${u.search}`;
    // Cross-site persistence is deliberately limited to canonical ad-tech provider
    // suffixes. Substring matching (for example "branch" or "adjust" inside an
    // unrelated hostname) can poison Adaptive Memory and create hard-to-recover
    // false positives. Generic path/query heuristics remain first-party only.
    return (!own && strongProviderHost(u.hostname))
      || (own && (STRONG_PATH.test(pathQuery) || STRONG_QUERY.test(pathQuery)));
  }
  function learn(raw) {
    if (!active() || sent >= 60 || !worthy(raw)) return;
    let u;
    try { u = new URL(String(raw || ""), location.href); } catch (_) { return; }
    const key = `${u.hostname}${u.pathname.replace(/[0-9a-f]{8,}/ig, "*").slice(0, 180)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    chrome.runtime.sendMessage({ type:"titanLearnResource", url:u.href, pageHost:location.hostname }, () => void chrome.runtime.lastError);
  }
  function scanExisting() {
    try { for (const entry of performance.getEntriesByType("resource")) learn(entry.name); } catch (_) {}
  }
  function refreshPrefs() {
    chrome.storage.local.get({ enabled:true, mode:"standard", allowSites:[], [RECOVERY_KEY]:{} }, (prefs) => {
      enabled = prefs.enabled !== false;
      mode = prefs.mode === "ultra" ? "ultra" : "standard";
      allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      heuristicRecoverySites = prefs[RECOVERY_KEY] && typeof prefs[RECOVERY_KEY] === "object" ? prefs[RECOVERY_KEY] : {};
      if (active()) scanExisting();
    });
  }

  try {
    const observer = new PerformanceObserver((list) => {
      if (!active()) return;
      for (const entry of list.getEntries()) if (entry?.entryType === "resource") learn(entry.name);
    });
    observer.observe({ type:"resource", buffered:true });
  } catch (_) {}

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode || changes.allowSites || changes[RECOVERY_KEY])) refreshPrefs();
  });
  refreshPrefs();
})();
