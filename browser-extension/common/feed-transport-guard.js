(() => {
  if (globalThis.__xadFeedTransportGuardV1) return;
  globalThis.__xadFeedTransportGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const FEED_FETCH_TIMEOUT_MS = 15 * 1000;
  const FEED_ACCEPT = "application/json,text/plain;q=0.9,application/octet-stream;q=0.8";
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

  function publicDataHeaders() {
    const headers = new Headers();
    headers.set("accept", FEED_ACCEPT);
    return headers;
  }

  function hardenedInit(init) {
    return {
      ...(init || {}),
      // Protection feeds are public immutable-style data. Do not inherit arbitrary
      // caller headers (Authorization, Cookie, API keys, etc.) and do not let the
      // browser HTTP cache become a second, unvalidated fallback layer. xADKiller's
      // own validated known-good cache remains the only offline fallback.
      headers:publicDataHeaders(),
      cache:"no-store",
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

    const finalUrl = String(response.url || "").trim();
    if (finalUrl && guardedKind(finalUrl) !== kind) fail("transport_provenance");
    validateContentLength(response);
    if (response.ok) validateContentType(response);
    return response;
  }

  async function bufferBoundedBody(response) {
    if (!response?.body || typeof response.body.getReader !== "function" || typeof Response !== "function") {
      return response;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part?.done) break;
        const chunk = part?.value instanceof Uint8Array ? part.value : new Uint8Array(part?.value || 0);
        total += chunk.byteLength;
        if (total > MAX_FEED_BYTES) {
          try { await reader.cancel("xad_feed_guard_payload_size"); } catch (_) {}
          fail("payload_size");
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock?.(); } catch (_) {}
    }

    const payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const buffered = new Response(payload, {
      status:response.status,
      statusText:response.statusText,
      headers:response.headers
    });
    try { Object.defineProperty(buffered, "url", { value:String(response.url || ""), configurable:true }); } catch (_) {}
    try { Object.defineProperty(buffered, "redirected", { value:Boolean(response.redirected), configurable:true }); } catch (_) {}
    return buffered;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);
    if (requestMethod(input, init) !== "GET") fail("transport_method");

    const timed = timedInit(input, init);
    try {
      const response = await nativeFetch(input, timed.init);
      validateResponse(kind, response);
      return await bufferBoundedBody(response);
    } finally {
      timed.cleanup();
    }
  };

  globalThis.XAD_FEED_TRANSPORT_GUARD = Object.freeze({
    MAX_FEED_BYTES,
    FEED_FETCH_TIMEOUT_MS,
    FEED_ACCEPT,
    guardedKind,
    requestMethod,
    publicDataHeaders,
    hardenedInit,
    timedInit,
    validateContentLength,
    validateContentType,
    validateResponse,
    bufferBoundedBody
  });
})();
