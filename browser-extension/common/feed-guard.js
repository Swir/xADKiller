(() => {
  if (globalThis.__xadFeedGuardV1) return;
  globalThis.__xadFeedGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const MAX_FEED_AGE_MS = 45 * 24 * 60 * 60 * 1000;
  const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
  const MAX_V2_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;
  const RETRY_BASE_MS = 15 * 1000;
  const RETRY_MAX_MS = 15 * 60 * 1000;
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
  function validRollbackRef(value) {
    const s = String(value || "").trim();
    return !!s
      && s.length <= 160
      && !s.startsWith("/")
      && !s.endsWith("/")
      && !s.includes("..")
      && /^[A-Za-z0-9._/-]+$/.test(s);
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
  function isRetryableFailure(reason) {
    const value = String(reason || "").toLowerCase();
    return /^http_(429|5\d\d)$/.test(value)
      || value === "aborterror"
      || value === "typeerror"
      || value === "network_error"
      || value === "failed_to_fetch";
  }
  function backoffMs(consecutiveFailures) {
    const failures = Math.max(0, Math.min(999, Math.floor(Number(consecutiveFailures || 0))));
    if (!failures) return 0;
    const shift = Math.min(6, failures - 1);
    return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** shift));
  }
  function parseRetryAfter(value, now = Date.now()) {
    const raw = String(value || "").trim();
    if (!raw) return 0;

    let waitMs = 0;
    if (/^\d+$/.test(raw)) {
      waitMs = Number(raw) * 1000;
    } else {
      const retryAt = Date.parse(raw);
      if (!Number.isFinite(retryAt)) return 0;
      waitMs = retryAt - now;
    }
    if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
    return Math.min(RETRY_MAX_MS, Math.max(RETRY_BASE_MS, Math.ceil(waitMs)));
  }
  function retryWaitMs(feedHealth, now = Date.now()) {
    const nextRetryAt = Math.max(0, Number(feedHealth?.nextRetryAt || 0));
    return nextRetryAt > now ? nextRetryAt - now : 0;
  }
  async function enforceRetryWindow(kind, now = Date.now()) {
    const health = await readHealth();
    if (retryWaitMs(health?.feeds?.[kind], now) > 0) fail("backoff");
  }
  function validateFeedTimestamp(value, now = Date.now()) {
    const raw = String(value || "").trim();
    const parsed = Date.parse(raw);
    if (!raw || !Number.isFinite(parsed)) fail("updated_at");
    if (parsed > now + MAX_FUTURE_SKEW_MS) fail("future_feed");
    if (now - parsed > MAX_FEED_AGE_MS) fail("stale_feed");
    return parsed;
  }
  function validateV2Contract(data, updatedAt, now = Date.now()) {
    const expiresRaw = String(data?.expires_at || "").trim();
    const expiresAt = Date.parse(expiresRaw);
    if (!expiresRaw || !Number.isFinite(expiresAt)) fail("expires_at");
    if (expiresAt <= updatedAt) fail("expiry_order");
    if (expiresAt <= now) fail("expired_feed");
    if (expiresAt - updatedAt > MAX_V2_LIFETIME_MS) fail("expiry_window");

    const rollback = data?.rollback;
    if (!rollback || typeof rollback !== "object" || Array.isArray(rollback)) fail("rollback");
    if (!validVersion(rollback.previous_version)) fail("rollback_version");
    if (String(rollback.previous_version) === String(data.feed_version)) fail("rollback_same_version");
    if (!validRollbackRef(rollback.previous_ref)) fail("rollback_ref");
    return { expiresAt, previousVersion:String(rollback.previous_version), previousRef:String(rollback.previous_ref) };
  }

  async function recordHealthNow(kind, ok, version, error, latencyMs, schema = 0, meta = {}) {
    try {
      const stored = await getLocal({ [HEALTH_KEY]:{ schema:1, feeds:{} } });
      const health = stored[HEALTH_KEY] && typeof stored[HEALTH_KEY] === "object"
        ? stored[HEALTH_KEY] : { schema:1, feeds:{} };
      const feeds = health.feeds && typeof health.feeds === "object" ? { ...health.feeds } : {};
      const previous = feeds[kind] && typeof feeds[kind] === "object" ? feeds[kind] : {};
      const now = Date.now();

      const acceptedAt = ok ? Math.max(0, Number(meta.updatedAt || 0)) : Math.max(0, Number(previous.lastFeedUpdatedAt || 0));
      let highestAt = Math.max(0, Number(previous.highestFeedUpdatedAt || previous.lastFeedUpdatedAt || 0));
      let highestVersion = String(previous.highestFeedVersion || previous.lastVersion || "").slice(0, 80);
      let highestSchema = Math.max(0, Number(previous.highestFeedSchema || previous.lastSchema || 0));
      if (ok && acceptedAt > 0 && (highestAt === 0 || acceptedAt > highestAt)) {
        highestAt = acceptedAt;
        highestVersion = validVersion(version) ? String(version).slice(0, 80) : highestVersion;
        highestSchema = schema === 1 || schema === 2 ? schema : highestSchema;
      } else if (ok && acceptedAt > 0 && acceptedAt === highestAt && !highestVersion && validVersion(version)) {
        highestVersion = String(version).slice(0, 80);
        highestSchema = schema === 1 || schema === 2 ? schema : highestSchema;
      }

      const consecutiveFailures = ok
        ? 0
        : Math.min(999, Math.max(0, Number(previous.consecutiveFailures || 0)) + 1);
      const retryAfterMs = !ok && isRetryableFailure(error)
        ? Math.min(RETRY_MAX_MS, Math.max(0, Number(meta.retryAfterMs || 0)))
        : 0;
      const nextRetryAt = !ok && isRetryableFailure(error)
        ? now + Math.max(backoffMs(consecutiveFailures), retryAfterMs)
        : 0;

      feeds[kind] = {
        successCount:Math.max(0, Number(previous.successCount || 0)) + (ok ? 1 : 0),
        failureCount:Math.max(0, Number(previous.failureCount || 0)) + (ok ? 0 : 1),
        consecutiveFailures,
        lastCheckedAt:now,
        lastSuccessAt:ok ? now : Math.max(0, Number(previous.lastSuccessAt || 0)),
        lastFailureAt:ok ? Math.max(0, Number(previous.lastFailureAt || 0)) : now,
        lastVersion:ok && validVersion(version) ? String(version).slice(0, 80) : String(previous.lastVersion || "").slice(0, 80),
        lastSchema:ok && (schema === 1 || schema === 2) ? schema : Math.max(0, Number(previous.lastSchema || 0)),
        lastError:ok ? "" : String(error || "unknown").slice(0, 120),
        lastLatencyMs:Math.max(0, Math.min(60_000, Math.round(Number(latencyMs || 0)))),
        lastFeedUpdatedAt:ok ? acceptedAt : Math.max(0, Number(previous.lastFeedUpdatedAt || 0)),
        highestFeedUpdatedAt:highestAt,
        highestFeedVersion:highestVersion,
        highestFeedSchema:highestSchema,
        nextRetryAt,
        backoffLevel:nextRetryAt ? consecutiveFailures : 0,
        lastRetryAfterMs:nextRetryAt ? retryAfterMs : 0,
        rollbackPreviousVersion:ok
          ? (schema === 2 ? String(meta.previousVersion || "").slice(0, 80) : "")
          : String(previous.rollbackPreviousVersion || "").slice(0, 80),
        rollbackPreviousRef:ok
          ? (schema === 2 ? String(meta.previousRef || "").slice(0, 160) : "")
          : String(previous.rollbackPreviousRef || "").slice(0, 160)
      };
      await setLocal({ [HEALTH_KEY]:{ schema:1, updatedAt:now, feeds } });
    } catch (_) {
      // Diagnostics must never break feed delivery or cache fallback.
    }
  }

  function recordHealth(kind, ok, version = "", error = "", latencyMs = 0, schema = 0, meta = {}) {
    healthWriteChain = healthWriteChain.then(
      () => recordHealthNow(kind, ok, version, error, latencyMs, schema, meta),
      () => recordHealthNow(kind, ok, version, error, latencyMs, schema, meta)
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
    if (!data || typeof data !== "object" || ![1, 2].includes(data.schema)) fail("schema");
    if (!validVersion(data.feed_version)) fail("version");
    const now = Date.now();
    const updatedAt = validateFeedTimestamp(data.updated_at, now);
    const contract = data.schema === 2 ? validateV2Contract(data, updatedAt, now) : null;
    return { data, updatedAt, contract };
  }

  async function validateTransition(kind, data, updatedAt) {
    const health = await readHealth();
    const previous = health?.feeds?.[kind];
    if (!previous || typeof previous !== "object") return;

    const version = String(data.feed_version || "");
    const lastVersion = String(previous.lastVersion || "");
    const lastSchema = Math.max(0, Number(previous.lastSchema || 0));
    const lastAcceptedAt = Math.max(0, Number(previous.lastFeedUpdatedAt || 0));
    const highestAt = Math.max(0, Number(previous.highestFeedUpdatedAt || lastAcceptedAt));
    const highestVersion = String(previous.highestFeedVersion || lastVersion || "");
    const highestSchema = Math.max(0, Number(previous.highestFeedSchema || lastSchema));
    const rollbackVersion = String(previous.rollbackPreviousVersion || "");

    // Re-fetching exactly the currently accepted immutable payload is always safe.
    if (lastVersion && version === lastVersion && updatedAt === lastAcceptedAt && data.schema === lastSchema) return;

    // Once a v2 high-water mark has been accepted, v1 can only reappear as the
    // explicitly authorised rollback version advertised by that accepted v2 feed.
    const authorisedRollback = !!rollbackVersion && version === rollbackVersion && updatedAt <= highestAt;
    if (highestSchema === 2 && data.schema === 1 && !authorisedRollback) fail("schema_downgrade");

    if (highestAt > 0) {
      if (updatedAt < highestAt && !authorisedRollback) fail("replay");
      if (updatedAt === highestAt && highestVersion && version !== highestVersion) fail("version_collision");
      if (updatedAt > highestAt && highestVersion && version === highestVersion) fail("version_reuse");
    }
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
    const parsed = await parseProtectedResponse(response);
    const { data, updatedAt } = parsed;
    await validateTransition(kind, data, updatedAt);
    if (kind === "live-shield") await validateLiveShield(data);
    else if (kind === "live-matrix") await validateLiveMatrix(data);
    else if (kind === "titan") await validateTitan(data);
    return parsed;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);

    // Do not hammer GitHub during an outage. Consumers already keep a known-good
    // cache, so a bounded local backoff intentionally fails fast and lets them
    // continue with validated cached data. Validation/schema failures never enter
    // this network backoff path, so corrected protection data can be picked up on
    // the very next scheduled/manual fetch.
    await enforceRetryWindow(kind);

    const started = Date.now();
    try {
      const response = await nativeFetch(input, init);
      const latency = Date.now() - started;
      if (!response?.ok) {
        const reason = `http_${Number(response?.status || 0)}`;
        const retryAfterMs = isRetryableFailure(reason)
          ? parseRetryAfter(response?.headers?.get?.("retry-after"), Date.now())
          : 0;
        await recordHealth(kind, false, "", reason, latency, 0, { retryAfterMs });
        return response;
      }
      const parsed = await validate(kind, response);
      const { data, updatedAt, contract } = parsed;
      await recordHealth(kind, true, data.feed_version, "", latency, data.schema, {
        updatedAt,
        previousVersion:contract?.previousVersion || "",
        previousRef:contract?.previousRef || ""
      });
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

  globalThis.XAD_FEED_GUARD = Object.freeze({
    guardedKind,
    validVersion,
    validRollbackRef,
    minRelative,
    validateFeedTimestamp,
    validateV2Contract,
    validateTransition,
    isRetryableFailure,
    backoffMs,
    parseRetryAfter,
    retryWaitMs,
    readHealth
  });
})();
