(() => {
  if (globalThis.__xadLiveCosmeticMatrix) return;
  globalThis.__xadLiveCosmeticMatrix = true;

  const RECOVERY_KEY = "xadHeuristicRecoverySitesV1";
  let styleEl = null;

  function normalizeHost(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function siteAllowed(host, allowSites) {
    host = normalizeHost(host);
    return (allowSites || []).some((entry) => {
      const d = normalizeHost(entry);
      return d && (host === d || host.endsWith("." + d));
    });
  }

  function recoveryActive(host, map, now = Date.now()) {
    host = normalizeHost(host);
    if (!host || !map || typeof map !== "object") return false;
    return Object.entries(map).some(([entry, rawUntil]) => {
      const d = normalizeHost(entry);
      const until = Number(rawUntil || 0);
      return d && Number.isFinite(until) && until > now && (host === d || host.endsWith("." + d));
    });
  }

  function cleanSelector(value) {
    const s = String(value || "").trim();
    if (!s || s.length > 180) return "";
    if (/[{}@]|url\s*\(|expression\s*\(|javascript:/i.test(s)) return "";
    try { document.querySelector(s); } catch (_) { return ""; }
    return s;
  }

  function ensureStyle() {
    if (styleEl?.isConnected) return styleEl;
    styleEl = document.createElement("style");
    styleEl.id = "xadkiller-live-cosmetic";
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  }

  function apply() {
    chrome.storage.local.get({
      enabled:true,
      mode:"standard",
      allowSites:[],
      [RECOVERY_KEY]:{},
      xadLiveCosmeticStandard:[],
      xadLiveCosmeticUltra:[]
    }, (prefs) => {
      const el = ensureStyle();
      const enabled = prefs.enabled !== false
        && !siteAllowed(location.hostname, Array.isArray(prefs.allowSites) ? prefs.allowSites : [])
        && !recoveryActive(location.hostname, prefs[RECOVERY_KEY]);
      if (!enabled) {
        el.textContent = "";
        el.disabled = true;
        return;
      }
      const raw = prefs.mode === "ultra"
        ? [...(prefs.xadLiveCosmeticStandard || []), ...(prefs.xadLiveCosmeticUltra || [])]
        : (prefs.xadLiveCosmeticStandard || []);
      const selectors = [...new Set(raw.map(cleanSelector).filter(Boolean))].slice(0, 300);
      el.textContent = selectors.map((s) => `${s}{display:none!important;visibility:hidden!important;max-height:0!important;min-height:0!important}`).join("\n");
      el.disabled = false;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled || changes.mode || changes.allowSites || changes[RECOVERY_KEY] || changes.xadLiveCosmeticStandard || changes.xadLiveCosmeticUltra) apply();
  });

  const begin = () => {
    if (!document.documentElement) return setTimeout(begin, 15);
    apply();
  };
  begin();
})();