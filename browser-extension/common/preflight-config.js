(() => {
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
  function publish() {
    chrome.storage.local.get({ enabled:true, mode:"standard", smartEnabled:true, allowSites:[] }, (prefs) => {
      const active = prefs.enabled !== false && !isAllowed(location.hostname, Array.isArray(prefs.allowSites) ? prefs.allowSites : []);
      try {
        window.dispatchEvent(new CustomEvent("xadkiller:preflight-config", {
          detail:{ active, mode:prefs.mode === "ultra" ? "ultra" : "standard", smartEnabled:prefs.smartEnabled !== false }
        }));
      } catch (_) {}
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode || changes.smartEnabled || changes.allowSites)) publish();
  });
  publish();
})();
