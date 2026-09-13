try { importScripts("build-meta.js"); } catch (_) {}

const STANDARD_RULESET = "standard";
const ULTRA_RULESET = "ultra";

const INTEL_RULE_MIN = 100000;
const INTEL_RULE_MAX = 123999;
const CORE_RULE_MIN = 130000;
const CORE_RULE_MAX = 130099;
const ALLOW_RULE_MIN = 900000;
const ALLOW_RULE_MAX = 900499;
const CUSTOM_RULE_MIN = 910000;
const CUSTOM_RULE_MAX = 914999;

const STANDARD_INTEL_LIMIT = 16000;
const ULTRA_INTEL_LIMIT = 24000;
const BLOCK_RESOURCE_TYPES = [
  "script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"
];

const ULTRA_CORE_PATTERNS = [
  { filter: "/ads.js", types: ["script"] },
  { filter: "/pagead.js", types: ["script"] },
  { filter: "/adsbygoogle.js", types: ["script"] },
  { filter: "/advertising.js", types: ["script"] },
  { filter: "/adserver.js", types: ["script"] },
  { filter: "/ad-loader.js", types: ["script"] },
  { filter: "/adloader.js", types: ["script"] },
  { filter: "/ad-script.js", types: ["script"] },
  { filter: "/adscript.js", types: ["script"] },
  { filter: "/prebid.js", types: ["script"] },
  { filter: "/prebid.min.js", types: ["script"] },
  { filter: "/sponsor.js", types: ["script"] },
  { filter: "/adserver/", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "/adservice/", types: ["script","xmlhttprequest","sub_frame"] }
];

let intelDomainsPromise = null;

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

async function loadIntelDomains() {
  if (!intelDomainsPromise) {
    intelDomainsPromise = fetch(chrome.runtime.getURL("rules/dynamic-intel.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`dynamic_intel_http_${response.status}`);
        return response.json();
      })
      .then((items) => [...new Set((Array.isArray(items) ? items : []).map(normalizeHost).filter(Boolean))].slice(0, ULTRA_INTEL_LIMIT))
      .catch((error) => {
        console.warn("xADKiller dynamic intelligence unavailable", error);
        return [];
      });
  }
  return intelDomainsPromise;
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

function rebuildDynamicRules(allowSites, customDomains, mode = "standard", enabled = true, done = () => {}) {
  Promise.all([
    loadIntelDomains(),
    new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules || [])))
  ]).then(([intelDomains, current]) => {
    const removeRuleIds = current
      .filter((r) =>
        (r.id >= INTEL_RULE_MIN && r.id <= INTEL_RULE_MAX) ||
        (r.id >= CORE_RULE_MIN && r.id <= CORE_RULE_MAX) ||
        (r.id >= ALLOW_RULE_MIN && r.id <= ALLOW_RULE_MAX) ||
        (r.id >= CUSTOM_RULE_MIN && r.id <= CUSTOM_RULE_MAX)
      )
      .map((r) => r.id);

    const cleanAllow = [...new Set((allowSites || []).map(normalizeHost).filter(Boolean))].slice(0, 450);
    const cleanCustom = [...new Set((customDomains || []).map(normalizeHost).filter(Boolean))].slice(0, 4500);

    const allowRules = cleanAllow.map((domain, index) => ({
      id: ALLOW_RULE_MIN + index,
      priority: 100000,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame","sub_frame"] }
    }));

    const blockRules = enabled ? cleanCustom.map((domain, index) => ({
      id: CUSTOM_RULE_MIN + index,
      priority: 500,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame", ...BLOCK_RESOURCE_TYPES] }
    })) : [];

    const intelLimit = enabled ? (mode === "ultra" ? ULTRA_INTEL_LIMIT : STANDARD_INTEL_LIMIT) : 0;
    const intelRules = intelDomains.slice(0, intelLimit).map((domain, index) => ({
      id: INTEL_RULE_MIN + index,
      priority: 20,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: BLOCK_RESOURCE_TYPES }
    }));

    const coreRules = enabled && mode === "ultra" ? ULTRA_CORE_PATTERNS.map((item, index) => ({
      id: CORE_RULE_MIN + index,
      priority: 40,
      action: { type: "block" },
      condition: { urlFilter: item.filter, resourceTypes: item.types }
    })) : [];

    const addRules = [...allowRules, ...blockRules, ...intelRules, ...coreRules];
    if (addRules.length > 29950) throw new Error(`dynamic_rule_budget_exceeded_${addRules.length}`);

    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }, () => done(lastErrorMessage()));
  }).catch((error) => done(String(error?.message || error)));
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

function syncProtection(prefs, done = () => {}) {
  const enabled = prefs.enabled !== false;
  const mode = prefs.mode === "ultra" ? "ultra" : "standard";
  applyProtection(enabled, mode, (staticError) => {
    rebuildDynamicRules(prefs.allowSites, prefs.customDomains, mode, enabled, (dynamicError) => {
      done(staticError || dynamicError || "");
    });
  });
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
    syncProtection(normalized);
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
    defaults((prefs) => {
      const next = { ...prefs, enabled };
      chrome.storage.local.set({ enabled }, () => syncProtection(next, (error) => sendResponse({ ok: !error, error, enabled })));
    });
    return true;
  }

  if (msg.type === "setMode") {
    const mode = msg.mode === "ultra" ? "ultra" : "standard";
    defaults((prefs) => {
      const next = { ...prefs, mode };
      chrome.storage.local.set({ mode }, () => syncProtection(next, (error) => sendResponse({ ok: !error, error, mode })));
    });
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
      chrome.storage.local.set({ allowSites }, () =>
        rebuildDynamicRules(allowSites, prefs.customDomains, prefs.mode, prefs.enabled !== false, (error) =>
          sendResponse({ ok: !error, error, siteAllowed: !!msg.allowed, allowSites })
        )
      );
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
      chrome.storage.local.set({ customDomains }, () =>
        rebuildDynamicRules(prefs.allowSites, customDomains, prefs.mode, prefs.enabled !== false, (error) =>
          sendResponse({ ok: !error, error, customDomains })
        )
      );
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

  if (msg.type === "getDynamicShieldStats") {
    chrome.declarativeNetRequest.getDynamicRules((rules) => {
      const all = rules || [];
      sendResponse({
        ok: !lastErrorMessage(),
        total: all.length,
        intelligence: all.filter((r) => r.id >= INTEL_RULE_MIN && r.id <= INTEL_RULE_MAX).length,
        custom: all.filter((r) => r.id >= CUSTOM_RULE_MIN && r.id <= CUSTOM_RULE_MAX).length,
        core: all.filter((r) => r.id >= CORE_RULE_MIN && r.id <= CORE_RULE_MAX).length
      });
    });
    return true;
  }

  return false;
});
