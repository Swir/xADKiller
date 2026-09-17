(() => {
  if (globalThis.__xadFeedGuardV1) return;
  globalThis.__xadFeedGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const HEALTH_KEY = "xadFeedGuardHealthV1";
  const LIVE_SHIELD_PATH = "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
  const LIVE_MATRIX_PATH = "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
  const TITAN_PATH = "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";
  let healthWriteChain = Promise.resolve();

  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function setLocal(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  function validVersion(value) {
    const s = String(value || "").trim();
    return !!s && s.length <= 80 && !/[\r\n<>]/.test(s) && s.toLowerCase() !== "unknown";
  }
  function minRelative(previous, absoluteMin, ratio = 0.5) {
    const old = Math.max(0, Number(previous || 0));
    return old >= absoluteMin * 2 ? Math.max(absoluteMin, Math.floor(old * ratio)) : absoluteMin;
  }
  function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
  }
  function fail(reason) {
    throw new TypeError(`xad_feed_guard_${reason}`);
  }
  function safeReason(error) {
    const raw = String(error?.message || error || "unknown").toLowerCase();
    const guard = raw.match(/xad_feed_guard_([a-z0-9_.:-]+)/i);
    if (guard) return guard[1].slice(0, 120);
    const name = String(error?.name || "network_error").toLowerCase().replace(/[^a-z0-9_.:-]/g, "_");
    return name.slice(0, 120) || "network_error";
  }

  async function recordHealthNow(kind, ok, version, error, latencyMs) {
    try {
      const stored = await getLocal({ [HEALTH_KEY]:{ schema:1, feeds:{} } });
      const health = stored[HEALTH_KEY] && typeof stored[HEALTH_KEY] === "object"
        ? stored[HEALTH_KEY] : { schema:1, feeds:{} };
      const feeds = health.feeds && typeof health.feeds === "object" ? { ...health.feeds } : {};
      const previous = feeds[kind] && typeof feeds[kind] === "object" ? feeds[kind] : {};
      const now = Date.now();
      feeds[kind] = {
        successCount:Math.max(0, Number(previous.successCount || 0)) + (ok ? 1 : 0),
        failureCount:Math.max(0, Number(previous.failureCount || 0)) + (ok ? 0 : 1),
        consecutiveFailures:ok ? 0 : Math.min(999, Math.max(0, Number(previous.consecutiveFailures || 0)) + 1),
        lastCheckedAt:now,
        lastSuccessAt:ok ? now : Math.max(0, Number(previous.lastSuccessAt || 0)),
        lastFailureAt:ok ? Math.max(0, Number(previous.lastFailureAt || 0)) : now,
        lastVersion:ok && validVersion(version) ? String(version).slice(0, 80) : String(previous.lastVersion || "").slice(0, 80),
        lastError:ok ? "" : String(error || "unknown").slice(0, 120),
        lastLatencyMs:Math.max(0, Math.min(60_000, Math.round(Number(latencyMs || 0))))
      };
      await setLocal({ [HEALTH_KEY]:{ schema:1, updatedAt:now, feeds } });
    } catch (_) {
      // Diagnostics must never break feed delivery or cache fallback.
    }
  }

  function recordHealth(kind, ok, version = "", error = "", latencyMs = 0) {
    healthWriteChain = healthWriteChain.then(
      () => recordHealthNow(kind, ok, version, error, latencyMs),
      () => recordHealthNow(kind, ok, version, error, latencyMs)
    );
    return healthWriteChain;
  }

  async function readHealth() {
    try {
      await healthWriteChain;
      const stored = await getLocal({ [HEALTH_KEY]:{ schema:1, feeds:{} } });
      const health = stored[HEALTH_KEY];
      if (!health || typeof health !== "object") return { schema:1, feeds:{} };
      return health;
    } catch (_) {
      return { schema:1, feeds:{} };
    }
  }

  async function parseProtectedResponse(response) {
    const text = await response.clone().text();
    if (!text || text.length > MAX_FEED_BYTES) fail("payload_size");
    let data;
    try { data = JSON.parse(text); } catch (_) { fail("json"); }
    if (!data || typeof data !== "object" || data.schema !== 1) fail("schema");
    if (!validVersion(data.feed_version)) fail("version");
    return data;
  }

  async function validateLiveShield(data) {
    const previous = await getLocal({ liveStandardDomains:[], liveUltraDomains:[] });
    const standard = arrayLength(data.standard_domains);
    const ultra = arrayLength(data.ultra_domains);
    const minStandard = minRelative(arrayLength(previous.liveStandardDomains), 20, 0.5);
    if (standard < minStandard) fail(`live_shield_standard_${standard}_lt_${minStandard}`);
    const oldUltra = arrayLength(previous.liveUltraDomains);
    if (oldUltra >= 20 && ultra < Math.floor(oldUltra * 0.35)) fail("live_shield_ultra_shrink");
  }

  async function validateLiveMatrix(data) {
    const previous = await getLocal({
      xadLiveSignaturesStandard:[],
      xadLiveSignaturesUltra:[],
      xadLiveCosmeticStandard:[],
      xadLiveCosmeticUltra:[]
    });
    const standard = arrayLength(data.standard_signatures);
    const cosmetic = arrayLength(data.standard_cosmetic);
    const minStandard = minRelative(arrayLength(previous.xadLiveSignaturesStandard), 8, 0.5);
    const minCosmetic = minRelative(arrayLength(previous.xadLiveCosmeticStandard), 8, 0.5);
    if (standard < minStandard) fail(`live_matrix_standard_${standard}_lt_${minStandard}`);
    if (cosmetic < minCosmetic) fail(`live_matrix_cosmetic_${cosmetic}_lt_${minCosmetic}`);

    const oldUltra = arrayLength(previous.xadLiveSignaturesUltra);
    const oldCosmeticUltra = arrayLength(previous.xadLiveCosmeticUltra);
    if (oldUltra >= 8 && arrayLength(data.ultra_signatures) < Math.floor(oldUltra * 0.35)) fail("live_matrix_ultra_shrink");
    if (oldCosmeticUltra >= 8 && arrayLength(data.ultra_cosmetic) < Math.floor(oldCosmeticUltra * 0.35)) fail("live_matrix_ultra_cosmetic_shrink");
  }

  async function validateTitan(data) {
    const previous = await getLocal({ xadTitanFeed:null });
    const regex = arrayLength(data.regex_signatures);
    const oldRegex = arrayLength(previous.xadTitanFeed?.regex);
    const minimum = minRelative(oldRegex, 2, 0.5);
    if (regex < minimum) fail(`titan_regex_${regex}_lt_${minimum}`);
  }

  function guardedKind(urlValue) {
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return ""; }
    if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") return "";
    if (url.pathname === LIVE_SHIELD_PATH) return "live-shield";
    if (url.pathname === LIVE_MATRIX_PATH) return "live-matrix";
    if (url.pathname === TITAN_PATH) return "titan";
    return "";
  }

  async function validate(kind, response) {
    const data = await parseProtectedResponse(response);
    if (kind === "live-shield") await validateLiveShield(data);
    else if (kind === "live-matrix") await validateLiveMatrix(data);
    else if (kind === "titan") await validateTitan(data);
    return data;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);

    const started = Date.now();
    try {
      const response = await nativeFetch(input, init);
      const latency = Date.now() - started;
      if (!response?.ok) {
        await recordHealth(kind, false, "", `http_${Number(response?.status || 0)}`, latency);
        return response;
      }
      const data = await validate(kind, response);
      await recordHealth(kind, true, data.feed_version, "", latency);
      return response;
    } catch (error) {
      await recordHealth(kind, false, "", safeReason(error), Date.now() - started);
      throw error;
    }
  };

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type !== "getFeedGuardHealth") return false;
      readHealth().then((health) => sendResponse({ ok:true, health }))
        .catch((error) => sendResponse({ ok:false, error:safeReason(error) }));
      return true;
    });
  } catch (_) {}

  globalThis.XAD_FEED_GUARD = Object.freeze({ guardedKind, validVersion, minRelative, readHealth });
})();
