try { importScripts("build-meta.js"); } catch (_) {}

const STANDARD_RULESET = "standard";
const ULTRA_RULESET = "ultra";

const INTEL_RULE_MIN = 100000;
const INTEL_RULE_MAX = 123999;
const CORE_RULE_MIN = 130000;
const CORE_RULE_MAX = 130199;
const LIVE_RULE_MIN = 140000;
const LIVE_RULE_MAX = 140899;
const ALLOW_RULE_MIN = 900000;
const ALLOW_RULE_MAX = 900499;
const CUSTOM_RULE_MIN = 910000;
const CUSTOM_RULE_MAX = 914999;

const STANDARD_INTEL_LIMIT = 16000;
const ULTRA_INTEL_LIMIT = 24000;
const LIVE_STANDARD_LIMIT = 500;
const LIVE_ULTRA_LIMIT = 900;
const LIVE_REFRESH_MINUTES = 360;
const LIVE_CACHE_MAX_AGE = LIVE_REFRESH_MINUTES * 60 * 1000;
const LIVE_ALARM = "xadkiller-live-shield-refresh";
const LIVE_FEED_URL = "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";

const BLOCK_RESOURCE_TYPES = [
  "script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"
];

const STANDARD_CORE_PATTERNS = [
  { filter: "/ads.js", types: ["script"] },
  { filter: "/pagead.js", types: ["script"] },
  { filter: "/widget/ads.", types: ["script"] },
  { filter: "/adsbygoogle.js", types: ["script"] },
  { filter: "/advertising.js", types: ["script"] },
  { filter: "/adserver.js", types: ["script"] },
  { filter: "/ad-loader.js", types: ["script"] },
  { filter: "/adloader.js", types: ["script"] },
  { filter: "/ad-script.js", types: ["script"] },
  { filter: "/adscript.js", types: ["script"] },
  { filter: "/prebid.js", types: ["script"] },
  { filter: "/prebid.min.js", types: ["script"] },
  { filter: "/pagead/", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "/gampad/", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "/securepubads/", types: ["script","xmlhttprequest"] },
  { filter: "/adserver/", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "/adservice/", types: ["script","xmlhttprequest","sub_frame"] }
];

const ULTRA_EXTRA_PATTERNS = [
  { filter: "/vast/", types: ["xmlhttprequest","media","sub_frame"] },
  { filter: "/vmap/", types: ["xmlhttprequest","media"] },
  { filter: "/ima3/", types: ["script","xmlhttprequest"] },
  { filter: "/adrequest", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "/commercial/", types: ["script","xmlhttprequest","sub_frame","media"] },
  { filter: "?ad_unit=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "&ad_unit=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "?adunit=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "&adunit=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "?ad_slot=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "&ad_slot=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "?adslot=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "&adslot=", types: ["script","xmlhttprequest","sub_frame"] },
  { filter: "?gdfp_req=", types: ["xmlhttprequest","sub_frame"] },
  { filter: "&gdfp_req=", types: ["xmlhttprequest","sub_frame"] }
];

let intelDomainsPromise = null;
let liveFeedPromise = null;
let dynamicRebuildQueue = Promise.resolve();

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

function uniqueDomains(items, limit) {
  return [...new Set((Array.isArray(items) ? items : []).map(normalizeHost).filter(Boolean))].slice(0, limit);
}

function hostAllowed(host, allowSites) {
  host = normalizeHost(host);
  return !!host && (allowSites || []).some((entry) => {
    const d = normalizeHost(entry);
    return d && (host === d || host.endsWith("." + d));
  });
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}
function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}
function dynamicRules() {
  return new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules || [])));
}
function updateDynamicRulesAsync(removeRuleIds, addRules) {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }, () => {
      const error = lastErrorMessage();
      if (error) reject(new Error(error));
      else resolve();
    });
  });
}

async function loadIntelDomains() {
  if (!intelDomainsPromise) {
    intelDomainsPromise = fetch(chrome.runtime.getURL("rules/dynamic-intel.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`dynamic_intel_http_${response.status}`);
        return response.json();
      })
      .then((items) => uniqueDomains(items, ULTRA_INTEL_LIMIT))
      .catch((error) => {
        console.warn("xADKiller packaged intelligence unavailable", error);
        return [];
      });
  }
  return intelDomainsPromise;
}

async function readLiveCache() {
  const cached = await storageGet({
    liveFeedVersion: "",
    liveFeedUpdatedAt: "",
    liveFeedFetchedAt: 0,
    liveStandardDomains: [],
    liveUltraDomains: []
  });
  return {
    version: String(cached.liveFeedVersion || ""),
    updatedAt: String(cached.liveFeedUpdatedAt || ""),
    fetchedAt: Number(cached.liveFeedFetchedAt || 0),
    standard: uniqueDomains(cached.liveStandardDomains, LIVE_STANDARD_LIMIT),
    ultra: uniqueDomains(cached.liveUltraDomains, LIVE_ULTRA_LIMIT)
  };
}

async function fetchLiveFeed() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const joiner = LIVE_FEED_URL.includes("?") ? "&" : "?";
    const response = await fetch(`${LIVE_FEED_URL}${joiner}v=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "accept": "application/json" }
    });
    if (!response.ok) throw new Error(`live_feed_http_${response.status}`);
    const data = await response.json();
    if (data?.schema !== 1) throw new Error("live_feed_schema");
    const standard = uniqueDomains(data.standard_domains, LIVE_STANDARD_LIMIT);
    const ultraOnly = uniqueDomains(data.ultra_domains, LIVE_ULTRA_LIMIT);
    if (standard.length < 20) throw new Error(`live_feed_too_small_${standard.length}`);
    const feed = {
      version: String(data.feed_version || "unknown").slice(0, 80),
      updatedAt: String(data.updated_at || "").slice(0, 80),
      fetchedAt: Date.now(),
      standard,
      ultra: ultraOnly
    };
    await storageSet({
      liveFeedVersion: feed.version,
      liveFeedUpdatedAt: feed.updatedAt,
      liveFeedFetchedAt: feed.fetchedAt,
      liveStandardDomains: feed.standard,
      liveUltraDomains: feed.ultra
    });
    return feed;
  } finally {
    clearTimeout(timer);
  }
}

async function loadLiveFeed(force = false) {
  if (liveFeedPromise && !force) return liveFeedPromise;
  liveFeedPromise = (async () => {
    const cached = await readLiveCache();
    const fresh = cached.standard.length >= 20 && (Date.now() - cached.fetchedAt) < LIVE_CACHE_MAX_AGE;
    if (!force && fresh) return cached;
    try {
      return await fetchLiveFeed();
    } catch (error) {
      console.warn("xADKiller Live Shield update failed; using cache/fallback", error);
      return cached;
    }
  })();
  try {
    return await liveFeedPromise;
  } finally {
    liveFeedPromise = null;
  }
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
  // Multiple lifecycle paths can rebuild the same DNR pool at startup: installation/startup,
  // a just-finished Live Shield fetch, mode changes and user edits. Chromium applies
  // updateDynamicRules atomically, but overlapping calls can temporarily count both rule
  // generations against the dynamic quota. Serialize the complete read/build/write cycle so
  // each generation removes the actual current xADKiller IDs before adding its replacement.
  const rebuild = async () => {
    const [intelDomains, liveFeed, current] = await Promise.all([loadIntelDomains(), loadLiveFeed(false), dynamicRules()]);
    const removeRuleIds = current
      .filter((r) =>
        (r.id >= INTEL_RULE_MIN && r.id <= INTEL_RULE_MAX) ||
        (r.id >= CORE_RULE_MIN && r.id <= CORE_RULE_MAX) ||
        (r.id >= LIVE_RULE_MIN && r.id <= LIVE_RULE_MAX) ||
        (r.id >= ALLOW_RULE_MIN && r.id <= ALLOW_RULE_MAX) ||
        (r.id >= CUSTOM_RULE_MIN && r.id <= CUSTOM_RULE_MAX)
      )
      .map((r) => r.id);

    const cleanAllow = uniqueDomains(allowSites, 450);
    const cleanCustom = uniqueDomains(customDomains, 4500);

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

    const liveDomains = enabled
      ? uniqueDomains(mode === "ultra" ? [...liveFeed.standard, ...liveFeed.ultra] : liveFeed.standard, mode === "ultra" ? LIVE_ULTRA_LIMIT : LIVE_STANDARD_LIMIT)
      : [];
    const liveRules = liveDomains.map((domain, index) => ({
      id: LIVE_RULE_MIN + index,
      priority: 80,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: BLOCK_RESOURCE_TYPES }
    }));

    const corePatterns = enabled ? (mode === "ultra" ? [...STANDARD_CORE_PATTERNS, ...ULTRA_EXTRA_PATTERNS] : STANDARD_CORE_PATTERNS) : [];
    const coreRules = corePatterns.map((item, index) => ({
      id: CORE_RULE_MIN + index,
      priority: 60,
      action: { type: "block" },
      condition: { urlFilter: item.filter, resourceTypes: item.types }
    }));

    const addRules = [...allowRules, ...blockRules, ...intelRules, ...liveRules, ...coreRules];
    if (addRules.length > 29950) throw new Error(`dynamic_rule_budget_exceeded_${addRules.length}`);
    await updateDynamicRulesAsync(removeRuleIds, addRules);
  };

  dynamicRebuildQueue = dynamicRebuildQueue.catch(() => {}).then(rebuild);
  dynamicRebuildQueue.then(() => done(""), (error) => done(String(error?.message || error)));
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
    learnWeights: {},
    liveFeedVersion: "",
    liveFeedUpdatedAt: "",
    liveFeedFetchedAt: 0,
    liveStandardDomains: [],
    liveUltraDomains: []
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

function createLiveAlarm() {
  try { chrome.alarms.create(LIVE_ALARM, { delayInMinutes: 1, periodInMinutes: LIVE_REFRESH_MINUTES }); } catch (_) {}
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
    createLiveAlarm();
    syncProtection(normalized);
    // The feed may finish after the user changes mode/settings. Re-read current prefs before
    // the refresh rebuild so stale startup STANDARD state can never overwrite a newer ULTRA
    // generation (or vice versa).
    loadLiveFeed(false).then(() => defaults((latest) => syncProtection(latest)));
    try { chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch (_) {}
  });
}

chrome.runtime.onInstalled.addListener(ensureDefaults);
chrome.runtime.onStartup.addListener(ensureDefaults);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== LIVE_ALARM) return;
  loadLiveFeed(true).then(() => defaults((prefs) => syncProtection(prefs)));
});

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
        liveShield: {
          version: String(prefs.liveFeedVersion || ""),
          updatedAt: String(prefs.liveFeedUpdatedAt || ""),
          fetchedAt: Number(prefs.liveFeedFetchedAt || 0),
          standard: Array.isArray(prefs.liveStandardDomains) ? prefs.liveStandardDomains.length : 0,
          ultra: Array.isArray(prefs.liveUltraDomains) ? prefs.liveUltraDomains.length : 0
        },
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

  if (msg.type === "refreshLiveShield") {
    loadLiveFeed(true).then((feed) => defaults((prefs) => {
      syncProtection(prefs, (error) => sendResponse({
        ok: !error,
        error,
        version: feed.version,
        standard: feed.standard.length,
        ultra: feed.ultra.length,
        fetchedAt: feed.fetchedAt
      }));
    })).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
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
        live: all.filter((r) => r.id >= LIVE_RULE_MIN && r.id <= LIVE_RULE_MAX).length,
        custom: all.filter((r) => r.id >= CUSTOM_RULE_MIN && r.id <= CUSTOM_RULE_MAX).length,
        core: all.filter((r) => r.id >= CORE_RULE_MIN && r.id <= CORE_RULE_MAX).length
      });
    });
    return true;
  }

  return false;
});
