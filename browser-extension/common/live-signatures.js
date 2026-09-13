(() => {
  const FEED_URL = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
  const RULE_MIN = 150000;
  const RULE_MAX = 150399;
  const RULE_LIMIT = RULE_MAX - RULE_MIN + 1;
  const ALARM = "xadkiller-live-matrix-refresh";
  const REFRESH_MINUTES = 360;
  const CACHE_MAX_AGE = REFRESH_MINUTES * 60 * 1000;
  const TYPES = new Set(["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"]);

  function cleanFilter(value) {
    const s = String(value || "").trim();
    if (s.length < 3 || s.length > 180) return "";
    if (/[^\x20-\x7E]/.test(s) || s.includes("||*") || s.includes("\n") || s.includes("\r")) return "";
    return s;
  }

  function cleanSignature(value) {
    if (!value || typeof value !== "object") return null;
    const filter = cleanFilter(value.filter);
    if (!filter) return null;
    const types = [...new Set((Array.isArray(value.types) ? value.types : []).filter((x) => TYPES.has(x)))].slice(0, 10);
    if (!types.length) return null;
    return { filter, types, thirdParty: value.third_party === true };
  }

  function cleanSelector(value) {
    const s = String(value || "").trim();
    if (!s || s.length > 180) return "";
    if (/[{}@]|url\s*\(|expression\s*\(|javascript:/i.test(s)) return "";
    return s;
  }

  function uniqueSignatures(items, limit = 200) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(items) ? items : []) {
      const item = cleanSignature(raw);
      if (!item) continue;
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  function uniqueSelectors(items, limit = 200) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(items) ? items : []) {
      const selector = cleanSelector(raw);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push(selector);
      if (out.length >= limit) break;
    }
    return out;
  }

  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function setLocal(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  function getDynamicRules() {
    return new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules || [])));
  }
  function updateDynamicRules(payload) {
    return new Promise((resolve, reject) => chrome.declarativeNetRequest.updateDynamicRules(payload, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) reject(new Error(error)); else resolve();
    }));
  }

  async function readCache() {
    const data = await getLocal({
      xadLiveMatrixVersion: "",
      xadLiveMatrixFetchedAt: 0,
      xadLiveSignaturesStandard: [],
      xadLiveSignaturesUltra: [],
      xadLiveCosmeticStandard: [],
      xadLiveCosmeticUltra: []
    });
    return {
      version: String(data.xadLiveMatrixVersion || ""),
      fetchedAt: Number(data.xadLiveMatrixFetchedAt || 0),
      standard: uniqueSignatures(data.xadLiveSignaturesStandard, 200),
      ultra: uniqueSignatures(data.xadLiveSignaturesUltra, 200),
      cosmeticStandard: uniqueSelectors(data.xadLiveCosmeticStandard, 200),
      cosmeticUltra: uniqueSelectors(data.xadLiveCosmeticUltra, 200)
    };
  }

  async function fetchFeed() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`${FEED_URL}?v=${Date.now()}`, { cache:"no-store", signal:controller.signal, headers:{ accept:"application/json" } });
      if (!response.ok) throw new Error(`live_matrix_http_${response.status}`);
      const data = await response.json();
      if (data?.schema !== 1) throw new Error("live_matrix_schema");
      const feed = {
        version: String(data.feed_version || "unknown").slice(0, 80),
        fetchedAt: Date.now(),
        standard: uniqueSignatures(data.standard_signatures, 200),
        ultra: uniqueSignatures(data.ultra_signatures, 200),
        cosmeticStandard: uniqueSelectors(data.standard_cosmetic, 200),
        cosmeticUltra: uniqueSelectors(data.ultra_cosmetic, 200)
      };
      if (feed.standard.length < 8 || feed.cosmeticStandard.length < 8) throw new Error("live_matrix_too_small");
      await setLocal({
        xadLiveMatrixVersion: feed.version,
        xadLiveMatrixFetchedAt: feed.fetchedAt,
        xadLiveSignaturesStandard: feed.standard,
        xadLiveSignaturesUltra: feed.ultra,
        xadLiveCosmeticStandard: feed.cosmeticStandard,
        xadLiveCosmeticUltra: feed.cosmeticUltra
      });
      return feed;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadFeed(force = false) {
    const cached = await readCache();
    if (!force && cached.version && (Date.now() - cached.fetchedAt) < CACHE_MAX_AGE) return cached;
    try {
      return await fetchFeed();
    } catch (error) {
      console.warn("xADKiller Live Matrix update failed; using validated cache", error);
      return cached;
    }
  }

  async function applyRules() {
    const [prefs, feed, current] = await Promise.all([
      getLocal({ enabled:true, mode:"standard" }),
      loadFeed(false),
      getDynamicRules()
    ]);
    const removeRuleIds = current.filter((r) => r.id >= RULE_MIN && r.id <= RULE_MAX).map((r) => r.id);
    if (prefs.enabled === false) {
      await updateDynamicRules({ removeRuleIds, addRules:[] });
      return { count:0, version:feed.version };
    }

    const signatures = prefs.mode === "ultra" ? [...feed.standard, ...feed.ultra] : feed.standard;
    const addRules = signatures.slice(0, RULE_LIMIT).map((item, index) => ({
      id: RULE_MIN + index,
      priority: item.thirdParty ? 55 : 75,
      action: { type:"block" },
      condition: {
        urlFilter: item.filter,
        resourceTypes: item.types,
        ...(item.thirdParty ? { domainType:"thirdParty" } : {})
      }
    }));
    await updateDynamicRules({ removeRuleIds, addRules });
    return { count:addRules.length, version:feed.version };
  }

  async function refresh(force = false) {
    const feed = await loadFeed(force);
    const applied = await applyRules();
    return {
      ok:true,
      version:feed.version,
      signatures:applied.count,
      cosmeticStandard:feed.cosmeticStandard.length,
      cosmeticUltra:feed.cosmeticUltra.length,
      fetchedAt:feed.fetchedAt
    };
  }

  function schedule() {
    try { chrome.alarms.create(ALARM, { delayInMinutes:1, periodInMinutes:REFRESH_MINUTES }); } catch (_) {}
  }

  chrome.runtime.onInstalled.addListener(() => { schedule(); refresh(true).catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { schedule(); refresh(false).catch(() => {}); });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM) refresh(true).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode)) applyRules().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "refreshLiveMatrix") {
      refresh(true).then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
      return true;
    }
    if (msg?.type === "getLiveMatrixStats") {
      Promise.all([readCache(), getDynamicRules()]).then(([cache, rules]) => sendResponse({
        ok:true,
        version:cache.version,
        signatures:rules.filter((r) => r.id >= RULE_MIN && r.id <= RULE_MAX).length,
        cosmeticStandard:cache.cosmeticStandard.length,
        cosmeticUltra:cache.cosmeticUltra.length,
        fetchedAt:cache.fetchedAt
      }));
      return true;
    }
    return false;
  });

  schedule();
  refresh(false).catch(() => {});
})();
