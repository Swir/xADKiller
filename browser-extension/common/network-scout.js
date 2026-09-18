(() => {
  if (globalThis.__xadNetworkScoutV1) return;
  globalThis.__xadNetworkScoutV1 = true;

  const RECOVERY_KEY = "xadHeuristicRecoverySitesV1";
  const STRONG_HOST = /(doubleclick|googlesyndication|googleadservices|amazon-adsystem|adnxs|adsrvr|pubmatic|rubicon|criteo|taboola|outbrain|smartadserver|adform|prebid|hotjar|mouseflow|luckyorange|fullstory|logrocket|appsflyer|adjust|branch|kochava|unityads|samsungads|xiaomi|huawei|oppomobile)/i;
  const STRONG_PATH = /\/(?:ads?|adserver|adservice|adrequest|pagead|gampad|securepubads|prebid|vast|vmap|ima3|commercial|sponsor|sponsored|promoted)(?:[._\/-]|$)/i;
  const STRONG_QUERY = /(?:^|[?&])(?:ad_unit|adunit|ad_slot|adslot|gdfp_req|iu|campaign|impression)=/i;
  const LOCAL_SUFFIXES = [".local", ".localhost", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"];
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
    if (!host || isIpv4Literal(host) || host.includes(":") || host.startsWith("[") || host.endsWith("]")) return false;
    return !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
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
    return (!own && STRONG_HOST.test(u.hostname)) || (own && STRONG_PATH.test(pathQuery)) || STRONG_QUERY.test(pathQuery);
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
