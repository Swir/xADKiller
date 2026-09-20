(() => {
  "use strict";
  if (globalThis.__xadFeedV2BetaChannelV1) return;
  globalThis.__xadFeedV2BetaChannelV1 = true;

  const guardedFetch = globalThis.fetch.bind(globalThis);
  const guard = globalThis.XAD_FEED_TRANSPORT_GUARD;
  const STATE_KEY = "xadFeedV2BetaChannelV1";
  const RUNTIME_KEY = "xadFeedV2BetaRuntimeV1";
  const SCHEMA = 1;
  const MAX_SESSION_MS = 6 * 60 * 60 * 1000;
  const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
  const PINNED_REF = "0930f563b4a4bfdef67885988485bfa8c7646784";
  const RAW_PREFIX = `https://raw.githubusercontent.com/Swir/xADKiller/${PINNED_REF}/browser-intelligence/v2/`;
  const TARGETS = Object.freeze({
    "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json": Object.freeze({
      kind:"live-shield", pinnedUrl:`${RAW_PREFIX}xadkiller-live-shield.json`
    }),
    "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json": Object.freeze({
      kind:"live-matrix", pinnedUrl:`${RAW_PREFIX}xadkiller-live-matrix.json`
    }),
    "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json": Object.freeze({
      kind:"titan", pinnedUrl:`${RAW_PREFIX}xadkiller-titan-feed.json`
    })
  });
  const ALLOWED_TYPES = new Set(["application/json", "text/plain", "application/octet-stream"]);

  function getLocal(defaults) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(defaults, resolve); }
      catch (_) { resolve(defaults); }
    });
  }
  function setLocal(values) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(values, resolve); }
      catch (_) { resolve(); }
    });
  }
  function canonicalOriginal(input) {
    try {
      const value = guard?.requestUrlValue?.(input) ?? (typeof input === "string" ? input : input?.url || "");
      return guard?.canonicalFeedUrl?.(value) || "";
    } catch (_) { return ""; }
  }
  function requestMethod(input, init) {
    try {
      if (typeof guard?.requestMethod === "function") return guard.requestMethod(input, init);
    } catch (_) {}
    return String(init?.method || input?.method || "GET").trim().toUpperCase();
  }
  function normalizeState(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    const activatedAt = Number(raw.activated_at || 0);
    const expiresAt = Number(raw.expires_at || 0);
    if (raw.schema !== SCHEMA || raw.enabled !== true || raw.pinned_ref !== PINNED_REF) return null;
    if (!Number.isFinite(activatedAt) || !Number.isFinite(expiresAt) || activatedAt <= 0 || expiresAt <= 0) return null;
    if (activatedAt > now + MAX_CLOCK_SKEW_MS || expiresAt <= now) return null;
    if (expiresAt <= activatedAt || expiresAt - activatedAt > MAX_SESSION_MS) return null;
    return { schema:SCHEMA, enabled:true, activated_at:activatedAt, expires_at:expiresAt, pinned_ref:PINNED_REF };
  }
  async function activeState(now = Date.now()) {
    const stored = await getLocal({ [STATE_KEY]:null });
    return normalizeState(stored?.[STATE_KEY], now);
  }
  function safeReason(error) {
    return String(error?.message || error || "unknown")
      .toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 96) || "unknown";
  }
  async function recordRuntime(kind, patch) {
    try {
      const stored = await getLocal({ [RUNTIME_KEY]:{ schema:1, pinned_ref:PINNED_REF, feeds:{} } });
      const current = stored?.[RUNTIME_KEY] && typeof stored[RUNTIME_KEY] === "object"
        ? stored[RUNTIME_KEY] : { schema:1, pinned_ref:PINNED_REF, feeds:{} };
      const feeds = current.feeds && typeof current.feeds === "object" ? { ...current.feeds } : {};
      feeds[kind] = {
        ...(feeds[kind] && typeof feeds[kind] === "object" ? feeds[kind] : {}),
        ...patch,
        checked_at:Date.now()
      };
      await setLocal({ [RUNTIME_KEY]:{ schema:1, pinned_ref:PINNED_REF, updated_at:Date.now(), feeds } });
    } catch (_) {
      // Local diagnostics must never interfere with protection or fallback.
    }
  }
  function validatePinnedResponse(target, response) {
    if (!response || typeof response !== "object") throw new TypeError("xad_v2_beta_transport_response");
    if (response.redirected === true || Number(response.status) === 0 || String(response.type || "").toLowerCase() === "opaque") {
      throw new TypeError("xad_v2_beta_transport_provenance");
    }
    if (!response.ok || Number(response.status) !== 200) throw new TypeError(`xad_v2_beta_http_${Number(response.status) || 0}`);
    const finalUrl = String(response.url || "").trim();
    if (finalUrl !== target.pinnedUrl) throw new TypeError("xad_v2_beta_transport_provenance");
    const rawType = String(response.headers?.get?.("content-type") || "").trim().toLowerCase();
    const mediaType = rawType.split(";", 1)[0].trim();
    if (!ALLOWED_TYPES.has(mediaType)) throw new TypeError("xad_v2_beta_content_type");
    guard?.validateContentLength?.(response);
    guard?.validateCompleteRepresentation?.(response);
    return response;
  }
  function safePinnedInit(input, init) {
    const controller = new AbortController();
    const callerSignal = init?.signal || input?.signal || null;
    let detach = () => {};
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else if (typeof callerSignal.addEventListener === "function") {
        const onAbort = () => controller.abort();
        callerSignal.addEventListener("abort", onAbort, { once:true });
        detach = () => { try { callerSignal.removeEventListener?.("abort", onAbort); } catch (_) {} };
      }
    }
    const timeoutMs = Math.max(1, Math.min(15_000, Number(guard?.FEED_FETCH_TIMEOUT_MS || 15_000)));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      init:{
        method:"GET",
        headers:{ accept:String(guard?.FEED_ACCEPT || "application/json,text/plain;q=0.9,application/octet-stream;q=0.8") },
        cache:"no-store",
        redirect:"error",
        credentials:"omit",
        referrerPolicy:"no-referrer",
        mode:"cors",
        keepalive:false,
        signal:controller.signal
      },
      cleanup:() => { clearTimeout(timer); detach(); }
    };
  }
  async function fetchPinned(target, input, init) {
    const safe = safePinnedInit(input, init);
    try {
      const response = await guardedFetch(target.pinnedUrl, safe.init);
      validatePinnedResponse(target, response);
      if (typeof guard?.bufferBoundedBody === "function") return await guard.bufferBoundedBody(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const max = Number(guard?.MAX_FEED_BYTES || (2 * 1024 * 1024));
      if (bytes.byteLength > max) throw new TypeError("xad_v2_beta_payload_size");
      const rebuilt = new Response(bytes, { status:response.status, statusText:response.statusText, headers:response.headers });
      try { Object.defineProperty(rebuilt, "url", { value:target.pinnedUrl, configurable:true }); } catch (_) {}
      return rebuilt;
    } finally { safe.cleanup(); }
  }

  globalThis.fetch = async (input, init) => {
    const canonical = canonicalOriginal(input);
    const target = TARGETS[canonical];
    if (!target) return guardedFetch(input, init);
    if (requestMethod(input, init) !== "GET") return guardedFetch(input, init);

    const state = await activeState();
    if (!state) return guardedFetch(input, init);

    try {
      const response = await fetchPinned(target, input, init);
      await recordRuntime(target.kind, { transport:"pinned-v2", ok:true, status:200, fallback:false, error:"" });
      return response;
    } catch (error) {
      await recordRuntime(target.kind, { transport:"production-v1-fallback", ok:false, status:0, fallback:true, error:safeReason(error) });
      return guardedFetch(input, init);
    }
  };

  globalThis.XAD_FEED_V2_BETA_CHANNEL = Object.freeze({
    STATE_KEY, RUNTIME_KEY, SCHEMA, MAX_SESSION_MS, PINNED_REF, TARGETS,
    canonicalOriginal, normalizeState, activeState, validatePinnedResponse
  });
})();
