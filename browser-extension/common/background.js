try { importScripts("build-meta.js"); } catch (_) {}

const STANDARD_RULESET = "standard";
const ULTRA_RULESET = "ultra";
const ALLOW_RULE_MIN = 900000;
const ALLOW_RULE_MAX = 900499;
const CUSTOM_RULE_MIN = 910000;
const CUSTOM_RULE_MAX = 914999;

function lastErrorMessage() {
  return chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
}
function normalizeHost(value) {
  if (!value) return "";
  let host = String(value).trim().toLowerCase();
  try { if (host.includes("://")) host = new URL(host).hostname; } catch (_) {}
  host = host.replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..") || !host.includes(".")) return "";
  return host;
}
function hostAllowed(host, allowSites) {
  host = normalizeHost(host);
  return !!host && (allowSites || []).some((entry) => {
    const d = normalizeHost(entry);
    return d && (host === d || host.endsWith("." + d));
  });
}
function applyProtection(enabled, mode, done = () => {}) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  if (enabled) {
    enableRulesetIds.push(STANDARD_RULESET);
    if (mode === "ultra") enableRulesetIds.push(ULTRA_RULESET);
    else disableRulesetIds.push(ULTRA_RULESET);
  } else {
    disableRulesetIds.push(STANDARD_RULESET, ULTRA_RULESET);
  }
  chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }, () => done(lastErrorMessage()));
}
function rebuildDynamicRules(allowSites, customDomains, done = () => {}) {
  chrome.declarativeNetRequest.getDynamicRules((current) => {
    const removeRuleIds = (current || [])
      .filter((r) => (r.id >= ALLOW_RULE_MIN && r.id <= ALLOW_RULE_MAX) || (r.id >= CUSTOM_RULE_MIN && r.id <= CUSTOM_RULE_MAX))
      .map((r) => r.id);

    const cleanAllow = [...new Set((allowSites || []).map(normalizeHost).filter(Boolean))].slice(0, 450);
    const cleanCustom = [...new Set((customDomains || []).map(normalizeHost).filter(Boolean))].slice(0, 4500);
    const allowRules = cleanAllow.map((domain, index) => ({
      id: ALLOW_RULE_MIN + index,
      priority: 100000,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame","sub_frame"] }
    }));
    const blockRules = cleanCustom.map((domain, index) => ({
      id: CUSTOM_RULE_MIN + index,
      priority: 500,
      action: { type: "block" },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"]
      }
    }));
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [...allowRules, ...blockRules] }, () => done(lastErrorMessage()));
  });
}
function defaults(callback) {
  chrome.storage.local.get({
    enabled: true,
    mode: "standard",
    autoSkip: true,
    smartEnabled: true,
    allowSites: [],
    customDomains: [],
    customCosmetic: {},
    learnWeights: {}
  }, callback);
}
function ensureDefaults() {
  defaults((prefs) => {
    const normalized = {
      enabled: prefs.enabled !== false,
      mode: prefs.mode === "ultra" ? "ultra" : "standard",
      autoSkip: prefs.autoSkip !== false,
      smartEnabled: prefs.smartEnabled !== false,
      allowSites: Array.isArray(prefs.allowSites) ? prefs.allowSites : [],
      customDomains: Array.isArray(prefs.customDomains) ? prefs.customDomains : [],
      customCosmetic: prefs.customCosmetic && typeof prefs.customCosmetic === "object" ? prefs.customCosmetic : {},
      learnWeights: prefs.learnWeights && typeof prefs.learnWeights === "object" ? prefs.learnWeights : {}
    };
    chrome.storage.local.set(normalized);
    applyProtection(normalized.enabled, normalized.mode);
    rebuildDynamicRules(normalized.allowSites, normalized.customDomains);
    try { chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch (_) {}
  });
}
chrome.runtime.onInstalled.addListener(ensureDefaults);
chrome.runtime.onStartup.addListener(ensureDefaults);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "getState") {
    defaults((prefs) => {
      const host = normalizeHost(msg.host || "");
      sendResponse({
        ok: true,
        enabled: prefs.enabled !== false,
        mode: prefs.mode === "ultra" ? "ultra" : "standard",
        autoSkip: prefs.autoSkip !== false,
        smartEnabled: prefs.smartEnabled !== false,
        host,
        siteAllowed: hostAllowed(host, prefs.allowSites),
        allowSites: prefs.allowSites || [],
        customDomains: prefs.customDomains || [],
        build: self.XAD_BUILD_META || null
      });
    });
    return true;
  }

  if (msg.type === "setEnabled") {
    const enabled = !!msg.enabled;
    defaults((prefs) => chrome.storage.local.set({ enabled }, () => {
      applyProtection(enabled, prefs.mode, (error) => sendResponse({ ok: !error, error, enabled }));
    }));
    return true;
  }

  if (msg.type === "setMode") {
    const mode = msg.mode === "ultra" ? "ultra" : "standard";
    defaults((prefs) => chrome.storage.local.set({ mode }, () => {
      applyProtection(prefs.enabled !== false, mode, (error) => sendResponse({ ok: !error, error, mode }));
    }));
    return true;
  }

  if (msg.type === "setAutoSkip" || msg.type === "setSmartEnabled") {
    const key = msg.type === "setAutoSkip" ? "autoSkip" : "smartEnabled";
    const value = msg.type === "setAutoSkip" ? !!msg.autoSkip : !!msg.smartEnabled;
    chrome.storage.local.set({ [key]: value }, () => sendResponse({ ok: true, [key]: value }));
    return true;
  }

  if (msg.type === "setSiteAllowed") {
    const host = normalizeHost(msg.host || "");
    if (!host) { sendResponse({ ok: false, error: "invalid_host" }); return false; }
    defaults((prefs) => {
      const set = new Set((prefs.allowSites || []).map(normalizeHost).filter(Boolean));
      if (msg.allowed) set.add(host); else set.delete(host);
      const allowSites = [...set].slice(0, 450);
      chrome.storage.local.set({ allowSites }, () => rebuildDynamicRules(allowSites, prefs.customDomains, (error) =>
        sendResponse({ ok: !error, error, siteAllowed: !!msg.allowed, allowSites })
      ));
    });
    return true;
  }

  if (msg.type === "addCustomDomain" || msg.type === "removeCustomDomain") {
    const host = normalizeHost(msg.host || msg.domain || "");
    if (!host) { sendResponse({ ok: false, error: "invalid_host" }); return false; }
    defaults((prefs) => {
      const set = new Set((prefs.customDomains || []).map(normalizeHost).filter(Boolean));
      if (msg.type === "addCustomDomain") set.add(host); else set.delete(host);
      const customDomains = [...set].slice(0, 4500);
      chrome.storage.local.set({ customDomains }, () => rebuildDynamicRules(prefs.allowSites, customDomains, (error) =>
        sendResponse({ ok: !error, error, customDomains })
      ));
    });
    return true;
  }

  if (msg.type === "getNetworkStats") {
    const tabId = Number(msg.tabId);
    if (!Number.isInteger(tabId)) { sendResponse({ ok: false, count: 0 }); return false; }
    chrome.declarativeNetRequest.getMatchedRules({ tabId }, (details) => {
      const error = lastErrorMessage();
      const count = details?.rulesMatchedInfo?.length || 0;
      sendResponse({ ok: !error, error, count });
    });
    return true;
  }

  return false;
});
