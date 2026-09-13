const CORE_RULESET = "core";
const ALLOW_RULE_MIN = 900000;
const ALLOW_RULE_MAX = 900499;

function lastErrorMessage() {
  return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
}

function normalizeHost(value) {
  if (!value) return "";
  let host = String(value).trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch (_) {}
  host = host.replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return "";
  return host;
}

function hostAllowed(host, allowSites) {
  host = normalizeHost(host);
  if (!host) return false;
  return (allowSites || []).some((entry) => {
    const d = normalizeHost(entry);
    return d && (host === d || host.endsWith("." + d));
  });
}

function updateCoreEnabled(enabled, done = () => {}) {
  const change = enabled
    ? { enableRulesetIds: [CORE_RULESET], disableRulesetIds: [] }
    : { enableRulesetIds: [], disableRulesetIds: [CORE_RULESET] };
  chrome.declarativeNetRequest.updateEnabledRulesets(change, () => done(lastErrorMessage()));
}

function rebuildAllowRules(allowSites, done = () => {}) {
  chrome.declarativeNetRequest.getDynamicRules((current) => {
    const removeRuleIds = (current || [])
      .filter((r) => r.id >= ALLOW_RULE_MIN && r.id <= ALLOW_RULE_MAX)
      .map((r) => r.id);

    const clean = [...new Set((allowSites || []).map(normalizeHost).filter(Boolean))].slice(0, 450);
    const addRules = clean.map((domain, index) => ({
      id: ALLOW_RULE_MIN + index,
      priority: 100000,
      action: { type: "allowAllRequests" },
      condition: {
        requestDomains: [domain],
        resourceTypes: ["main_frame", "sub_frame"]
      }
    }));

    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }, () => {
      done(lastErrorMessage());
    });
  });
}

function ensureDefaults() {
  chrome.storage.local.get(
    { enabled: true, autoSkip: true, allowSites: [] },
    (prefs) => {
      const allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      chrome.storage.local.set({
        enabled: prefs.enabled !== false,
        autoSkip: prefs.autoSkip !== false,
        allowSites
      });
      updateCoreEnabled(prefs.enabled !== false);
      rebuildAllowRules(allowSites);
    }
  );
}

chrome.runtime.onInstalled.addListener(ensureDefaults);
chrome.runtime.onStartup.addListener(ensureDefaults);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "getState") {
    chrome.storage.local.get(
      { enabled: true, autoSkip: true, allowSites: [] },
      (prefs) => {
        const host = normalizeHost(msg.host || "");
        sendResponse({
          ok: true,
          enabled: prefs.enabled !== false,
          autoSkip: prefs.autoSkip !== false,
          host,
          siteAllowed: hostAllowed(host, prefs.allowSites),
          allowSites: prefs.allowSites || []
        });
      }
    );
    return true;
  }

  if (msg.type === "setEnabled") {
    const enabled = !!msg.enabled;
    chrome.storage.local.set({ enabled }, () => {
      updateCoreEnabled(enabled, (error) => sendResponse({ ok: !error, error, enabled }));
    });
    return true;
  }

  if (msg.type === "setAutoSkip") {
    const autoSkip = !!msg.autoSkip;
    chrome.storage.local.set({ autoSkip }, () => sendResponse({ ok: true, autoSkip }));
    return true;
  }

  if (msg.type === "setSiteAllowed") {
    const host = normalizeHost(msg.host || "");
    if (!host) {
      sendResponse({ ok: false, error: "invalid_host" });
      return false;
    }
    chrome.storage.local.get({ allowSites: [] }, (prefs) => {
      let allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites.map(normalizeHost).filter(Boolean) : [];
      const set = new Set(allowSites);
      if (msg.allowed) set.add(host);
      else set.delete(host);
      allowSites = [...set].slice(0, 450);
      chrome.storage.local.set({ allowSites }, () => {
        rebuildAllowRules(allowSites, (error) =>
          sendResponse({ ok: !error, error, siteAllowed: !!msg.allowed, allowSites })
        );
      });
    });
    return true;
  }

  return false;
});
