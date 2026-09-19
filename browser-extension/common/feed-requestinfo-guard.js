(() => {
  if (globalThis.__xadFeedRequestInfoGuardV1) return;
  globalThis.__xadFeedRequestInfoGuardV1 = true;

  // Feed Transport Guard is installed first and Feed Guard second. This final, tiny
  // boundary keeps Fetch's wider RequestInfo surface (URL, Request and stringifiable
  // values) from skipping the outer schema/anti-replay Feed Guard while preserving the
  // transport guard's deterministic GET/privacy contract underneath it.
  const guardedFetch = globalThis.fetch.bind(globalThis);
  const RAW_HOST = "raw.githubusercontent.com";
  const PROTECTED_PATHS = new Set([
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json"
  ]);

  function fail(reason) {
    throw new TypeError(`xad_feed_guard_${reason}`);
  }

  function requestUrlValue(input) {
    if (typeof input === "string") return input;
    if (input && typeof input === "object") {
      try {
        if (typeof input.url === "string" && input.url) return input.url;
      } catch (_) {}
      try {
        if (typeof input.href === "string" && input.href) return input.href;
      } catch (_) {}
    }
    try { return input == null ? "" : String(input); } catch (_) { return ""; }
  }

  function protectedIdentity(urlValue) {
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return null; }
    if (url.hostname !== RAW_HOST || !PROTECTED_PATHS.has(url.pathname)) return null;
    return url;
  }

  function validLocalCacheBuster(url) {
    if (!url.search) return true;
    const params = [...url.searchParams.entries()];
    return params.length === 1 && params[0][0] === "v" && /^\d{10,16}$/.test(params[0][1]);
  }

  function assertProtectedTransport(url) {
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !validLocalCacheBuster(url)) {
      fail("transport_canonical_url");
    }
  }

  function readOption(source, key) {
    if (!source || (typeof source !== "object" && typeof source !== "function")) return undefined;
    try { return source[key]; } catch (_) { fail(`requestinfo_${key}`); }
  }

  function normalizedProtectedInit(input, init) {
    const initMethod = readOption(init, "method");
    const inputMethod = readOption(input, "method");
    const effectiveMethod = initMethod || inputMethod;
    const initSignal = readOption(init, "signal");
    const inputSignal = readOption(input, "signal");
    const effectiveSignal = initSignal || inputSignal;
    const out = {};
    if (effectiveMethod != null && String(effectiveMethod).trim()) out.method = String(effectiveMethod);
    if (effectiveSignal) out.signal = effectiveSignal;
    return out;
  }

  globalThis.fetch = (input, init) => {
    const urlValue = requestUrlValue(input);
    const identity = protectedIdentity(urlValue);
    if (!identity) return guardedFetch(input, init);

    // Route every representation of a protected feed through the same string identity so
    // Feed Guard cannot be bypassed with new URL(), Request or Symbol.toPrimitive. Reject
    // obvious downgrade/credential/port/hash variants here too instead of treating them as
    // unrelated network traffic.
    assertProtectedTransport(identity);
    return guardedFetch(urlValue, normalizedProtectedInit(input, init));
  };

  globalThis.XAD_FEED_REQUESTINFO_GUARD = Object.freeze({
    requestUrlValue,
    protectedIdentity,
    validLocalCacheBuster,
    assertProtectedTransport,
    normalizedProtectedInit
  });
})();
