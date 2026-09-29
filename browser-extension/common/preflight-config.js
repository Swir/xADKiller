(() => {
  const RECOVERY_KEY = "xadHeuristicRecoverySitesV1";

  function normalizeHost(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }
  function isAllowed(host, allowSites) {
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
  function publish() {
    chrome.storage.local.get({ enabled:true, mode:"standard", smartEnabled:true, allowSites:[], [RECOVERY_KEY]:{} }, (prefs) => {
      const host = location.hostname;
      const recovered = recoveryActive(host, prefs[RECOVERY_KEY]);
      const active = prefs.enabled !== false
        && !isAllowed(host, Array.isArray(prefs.allowSites) ? prefs.allowSites : [])
        && !recovered;
      try {
        window.dispatchEvent(new CustomEvent("xadkiller:preflight-config", {
          detail:{
            active,
            heuristicRecovery:recovered,
            mode:prefs.mode === "ultra" ? "ultra" : "standard",
            smartEnabled:prefs.smartEnabled !== false
          }
        }));
      } catch (_) {}
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode || changes.smartEnabled || changes.allowSites || changes[RECOVERY_KEY])) publish();
  });
  publish();
})();