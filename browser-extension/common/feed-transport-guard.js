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
  const ALLOWED_SUCCESS_CONTENT_TYPES = new Set(["application/json", "text/plain", "application/octet-stream"]);

  function fail(reason) { throw new TypeError(`xad_feed_guard_${reason}`); }
  function parseApprovedUrl(urlValue) {
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return null; }
    if (url.protocol !== "https:" || url.hostname !== RAW_HOST || url.port || url.username || url.password) return null;
    const kind = APPROVED_PATHS[url.pathname] || "";
    return kind ? { url, kind } : null;
  }
  function safeCacheBuster(url) {
    if (!url.search) return true;
    if (url.hash) return false;
    const params = [...url.searchParams.entries()];
    return params.length === 1 && params[0][0] === "v" && /^\d{10,16}$/.test(params[0][1]);
  }
  function guardedKind(urlValue) {
    const parsed = parseApprovedUrl(urlValue);
    if (!parsed || parsed.url.hash || !safeCacheBuster(parsed.url)) return "";
    return parsed.kind;
  }
  function hasApprovedPath(urlValue) {
    return Boolean(parseApprovedUrl(urlValue));
  }
  function canonicalFeedUrl(urlValue) {
    const parsed = parseApprovedUrl(urlValue);
    if (!parsed || parsed.url.hash || !safeCacheBuster(parsed.url)) return "";
    return `https://${RAW_HOST}${parsed.url.pathname}`;
  }
  function requestMethod(input, init) {
    return String(init?.method || input?.method || "GET").trim().toUpperCase();
  }
  function publicDataHeaders(_sourceHeaders) {
    // Never preserve caller-controlled header values for public protection feeds. Even an
    // otherwise-safe header such as Accept can be abused as a covert carrier for tokens.
    // A single deterministic Accept value is sufficient for every approved data endpoint.
    return Object.freeze({ accept:FEED_ACCEPT });
  }
  function hardenedInit(_init) {
    // Protected feeds are public, read-only data endpoints. Build their RequestInit from a
    // tiny allowlist instead of spreading caller options: this prevents referrer/body/
    // integrity/keepalive/mode or future RequestInit fields from becoming a covert carrier,
    // altering fetch lifecycle, or weakening the deterministic transport contract.
    return {
      method:"GET",
      headers:publicDataHeaders(),
      cache:"no-store",
      redirect:"error",
      credentials:"omit",
      referrerPolicy:"no-referrer",
      mode:"cors",
      keepalive:false
    };
  }
  function timedInit(input, init, timeoutMs = FEED_FETCH_TIMEOUT_MS) {
    const next = hardenedInit(init);
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
    const boundedTimeout = Math.max(1, Math.min(FEED_FETCH_TIMEOUT_MS, Math.floor(Number(timeoutMs) || FEED_FETCH_TIMEOUT_MS)));
    const timer = setTimeout(() => controller.abort(), boundedTimeout);
    next.signal = controller.signal;
    return { init:next, cleanup:() => { clearTimeout(timer); detach(); } };
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
    // Successful protection feeds must self-identify as one of the approved data
    // media types. A missing MIME is ambiguous and must fail closed instead of
    // allowing untyped bytes to enter Feed Guard/cache processing.
    if (!raw) fail("content_type");
    const mediaType = raw.split(";", 1)[0].trim();
    if (!ALLOWED_SUCCESS_CONTENT_TYPES.has(mediaType)) fail("content_type");
    return mediaType;
  }
  function validateCompleteRepresentation(response) {
    if (!response?.ok) return response;
    // A 200 carrying Content-Range is still a partial-representation smell and must not
    // become known-good protection data. Genuine raw GitHub feed downloads are complete
    // representations and do not need byte-range semantics.
    const contentRange = String(response?.headers?.get?.("content-range") || "").trim();
    if (contentRange) fail("content_range");
    return response;
  }
  function validateResponse(kind, response) {
    if (!response || typeof response !== "object") fail("transport_response");
    if (response.redirected === true) fail("transport_redirect");
    const responseType = String(response.type || "").trim().toLowerCase();
    const status = Number(response.status);
    if (responseType === "opaque" || status === 0) fail("transport_opaque");
    // A protection-feed success must be a complete 200 response. Fetch considers 204
    // and 206 successful too, but an empty/partial representation must never become a
    // known-good ruleset. Non-success responses remain visible so Feed Guard can classify
    // rate-limit/server failures and fall back to its verified local cache.
    if (response.ok && status !== 200) fail("transport_status");
    const finalUrl = String(response.url || "").trim();
    const finalParsed = parseApprovedUrl(finalUrl);
    // Protected data must come back from the exact canonical endpoint we requested.
    // A missing URL, a different approved feed, or any final query/hash is rejected:
    // the caller-side ?v= cache buster is stripped before I/O and must never reappear.
    if (!finalParsed || finalParsed.kind !== kind || finalParsed.url.search || finalParsed.url.hash) {
      fail("transport_provenance");
    }
    validateContentLength(response);
    if (response.ok) {
      validateContentType(response);
      validateCompleteRepresentation(response);
    }
    return response;
  }
  function validateBufferedLength(response, actualBytes) {
    if (!response?.ok) return actualBytes;
    const raw = String(response?.headers?.get?.("content-length") || "").trim();
    if (!raw) return actualBytes;
    const declared = validateContentLength(response);
    // Browser Fetch transparently decodes compressed bodies while preserving the wire
    // Content-Length, so byte-for-byte equality is meaningful only for identity/unencoded
    // payloads. For those responses a mismatch is a strong truncation/smuggling signal and
    // must fail closed before a partial ruleset can enter the verified cache.
    const encoding = String(response?.headers?.get?.("content-encoding") || "").trim().toLowerCase();
    if (encoding && encoding !== "identity") return actualBytes;
    if (declared !== actualBytes) fail("content_length_mismatch");
    return actualBytes;
  }
  async function bufferBoundedBody(response) {
    // The streaming reader is what makes the 2 MiB ceiling apply to the bytes actually
    // delivered to Feed Guard, including responses with a missing/lying Content-Length.
    // If a successful protected response cannot expose a readable body, fail closed rather
    // than silently falling back to an unbounded path. HTTP error responses remain visible
    // to Feed Guard even when their body is unavailable so retry/backoff classification works.
    if (!response?.body || typeof response.body.getReader !== "function" || typeof Response !== "function") {
      if (response?.ok) fail("transport_body");
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
    } finally { try { reader.releaseLock?.(); } catch (_) {} }
    validateBufferedLength(response, total);
    const payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
    const buffered = new Response(payload, { status:response.status, statusText:response.statusText, headers:response.headers });
    try { Object.defineProperty(buffered, "url", { value:String(response.url || ""), configurable:true }); } catch (_) {}
    try { Object.defineProperty(buffered, "redirected", { value:Boolean(response.redirected), configurable:true }); } catch (_) {}
    return buffered;
  }
  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind && hasApprovedPath(urlValue)) fail("transport_canonical_url");
    if (!kind) return nativeFetch(input, init);
    if (requestMethod(input, init) !== "GET") fail("transport_method");
    const canonicalUrl = canonicalFeedUrl(urlValue);
    if (!canonicalUrl) fail("transport_canonical_url");
    const timed = timedInit(input, init);
    try {
      // Legacy callers may append a numeric ?v=<timestamp> cache-buster. It is accepted
      // only as local syntax and stripped before network I/O, so no query value is ever
      // transmitted to GitHub. HTTP cache is already disabled and xADKiller owns fallback.
      const response = await nativeFetch(canonicalUrl, timed.init);
      validateResponse(kind, response);
      return await bufferBoundedBody(response);
    } finally { timed.cleanup(); }
  };
  globalThis.XAD_FEED_TRANSPORT_GUARD = Object.freeze({
    MAX_FEED_BYTES, FEED_FETCH_TIMEOUT_MS, FEED_ACCEPT, guardedKind, hasApprovedPath,
    canonicalFeedUrl, requestMethod, publicDataHeaders, hardenedInit, timedInit,
    validateContentLength, validateContentType, validateCompleteRepresentation, validateResponse,
    validateBufferedLength, bufferBoundedBody
  });
})();
