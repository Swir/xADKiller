(() => {
  if (globalThis.__xadFeedTransportGuardV1) return;
  globalThis.__xadFeedTransportGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const RAW_HOST = "raw.githubusercontent.com";
  const APPROVED_PATHS = Object.freeze({
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json":"live-shield",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json":"live-matrix",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json":"titan"
  });

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

  function validateContentLength(response) {
    const raw = String(response?.headers?.get?.("content-length") || "").trim();
    if (!raw) return 0;
    if (!/^\d+$/.test(raw)) fail("content_length");
    const bytes = Number(raw);
    if (!Number.isSafeInteger(bytes) || bytes < 0) fail("content_length");
    if (bytes > MAX_FEED_BYTES) fail("payload_size");
    return bytes;
  }

  function validateResponse(kind, response) {
    if (!response || typeof response !== "object") fail("transport_response");
    if (response.redirected === true) fail("transport_redirect");

    // Browser fetch responses expose the final URL. Test/mocked Response objects may
    // leave it empty, so only enforce provenance when the runtime provides it.
    const finalUrl = String(response.url || "").trim();
    if (finalUrl && guardedKind(finalUrl) !== kind) fail("transport_provenance");
    validateContentLength(response);
    return response;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);
    if (requestMethod(input, init) !== "GET") fail("transport_method");

    // Protection feeds are public immutable-style data. Never send credentials or a
    // referrer, and never follow a redirect to another endpoint. Feed Guard above this
    // layer still performs schema/content/cache/anti-replay validation on the body.
    const response = await nativeFetch(input, hardenedInit(init));
    return validateResponse(kind, response);
  };

  globalThis.XAD_FEED_TRANSPORT_GUARD = Object.freeze({
    MAX_FEED_BYTES,
    guardedKind,
    requestMethod,
    hardenedInit,
    validateContentLength,
    validateResponse
  });
})();
