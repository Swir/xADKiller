(() => {
  if (globalThis.__xadFeedTransportGuardV1) return;
  globalThis.__xadFeedTransportGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const FEED_FETCH_TIMEOUT_MS = 15 * 1000;
  const RAW_HOST = "raw.githubusercontent.com";
  const APPROVED_PATHS = Object.freeze({
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json":"live-shield",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json":"live-matrix",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json":"titan"
  });
  const ALLOWED_SUCCESS_CONTENT_TYPES = new Set([
    "application/json",
    "text/plain",
    "application/octet-stream"
  ]);

  function fail(reason) {
    throw new TypeError(`xad_feed_guard_${reason}`);
  }

  function guardedKind(urlValue) {
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return ""; }
    if (url.protocol !== "https:" || url.hostname !== RAW_HOST || url.port || url.username || url.password) return "";
    return APPROVED_PATHS[url.pathname] || "";
  }

  function requestMethod(input, init) {
    return String(init?.method || input?.method || "GET").trim().toUpperCase();
  }

  function hardenedInit(init) {
    return {
      ...(init || {}),
      redirect:"error",
      credentials:"omit",
      referrerPolicy:"no-referrer"
    };
  }

  function timedInit(input, init, timeoutMs = FEED_FETCH_TIMEOUT_MS) {
    const next = hardenedInit(init);
    const controller = new AbortController();
    const callerSignal = init?.signal || input?.signal || null;
    let detach = () => {};

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else if (typeof callerSignal.addEventListener === "function") {
        const onAbort = () => controller.abort();
        callerSignal.addEventListener("abort", onAbort, { once:true });
        detach = () => {
          try { callerSignal.removeEventListener?.("abort", onAbort); } catch (_) {}
        };
      }
    }

    const boundedTimeout = Math.max(1, Math.min(FEED_FETCH_TIMEOUT_MS, Math.floor(Number(timeoutMs) || FEED_FETCH_TIMEOUT_MS)));
    const timer = setTimeout(() => controller.abort(), boundedTimeout);
    next.signal = controller.signal;
    return {
      init:next,
      cleanup:() => {
        clearTimeout(timer);
        detach();
      }
    };
  }

  function validateContentLength(response) {
    const raw = String(response?.headers?.get?.("content-length") || "").trim();
    if (!raw) return 0;
    if (!/^\d+$/.test(raw)) fail("content_length");
    const bytes = Number(raw);
    if (!Number.isSafeInteger(bytes) || bytes < 0) fail("content_length");
    if (bytes > MAX_FEED_BYTES) fail("payload_size");
    return bytes;
  }

  function validateContentType(response) {
    const raw = String(response?.headers?.get?.("content-type") || "").trim().toLowerCase();
    if (!raw) return "";
    const mediaType = raw.split(";", 1)[0].trim();
    if (!ALLOWED_SUCCESS_CONTENT_TYPES.has(mediaType)) fail("content_type");
    return mediaType;
  }

  function validateResponse(kind, response) {
    if (!response || typeof response !== "object") fail("transport_response");
    if (response.redirected === true) fail("transport_redirect");

    // Browser fetch responses expose the final URL. Test/mocked Response objects may
    // leave it empty, so only enforce provenance when the runtime provides it.
    const finalUrl = String(response.url || "").trim();
    if (finalUrl && guardedKind(finalUrl) !== kind) fail("transport_provenance");
    validateContentLength(response);
    // HTTP errors are classified by Feed Guard so Retry-After/backoff remains intact.
    // Successful protection data, however, must not arrive as HTML/script/media.
    if (response.ok) validateContentType(response);
    return response;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);
    if (requestMethod(input, init) !== "GET") fail("transport_method");

    // Protection feeds are public data-only payloads. Never send credentials/referrer,
    // never follow redirects, and bound a stalled network fetch so the MV3 worker can
    // fall back to its already validated local cache instead of hanging indefinitely.
    const timed = timedInit(input, init);
    try {
      const response = await nativeFetch(input, timed.init);
      return validateResponse(kind, response);
    } finally {
      timed.cleanup();
    }
  };

  globalThis.XAD_FEED_TRANSPORT_GUARD = Object.freeze({
    MAX_FEED_BYTES,
    FEED_FETCH_TIMEOUT_MS,
    guardedKind,
    requestMethod,
    hardenedInit,
    timedInit,
    validateContentLength,
    validateContentType,
    validateResponse
  });
})();
