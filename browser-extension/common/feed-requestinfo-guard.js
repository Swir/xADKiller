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

  function requestUrlCandidates(input) {
    if (typeof input === "string") return [input];
    const values = [];
    const add = (value) => {
      if (typeof value === "string" && value && !values.includes(value)) values.push(value);
    };
    if (input && (typeof input === "object" || typeof input === "function")) {
      try { add(input.url); } catch (_) {}
      try { add(input.href); } catch (_) {}
    }
    try { add(input == null ? "" : String(input)); } catch (_) {}
    return values;
  }

  function protectedIdentity(urlValue) {
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return null; }
    if (url.hostname !== RAW_HOST || !PROTECTED_PATHS.has(url.pathname)) return null;
    return url;
  }

  function resolveRequestIdentity(input) {
    const candidates = requestUrlCandidates(input);
    const parsed = [];
    let protectedCandidate = null;

    for (const value of candidates) {
      let url;
      try { url = new URL(value); } catch (_) { continue; }
      parsed.push({ value, url });
      if (!protectedCandidate && url.hostname === RAW_HOST && PROTECTED_PATHS.has(url.pathname)) {
        protectedCandidate = { value, url };
      }
    }

    if (!protectedCandidate) {
      return { urlValue:candidates[0] || "", identity:null };
    }

    // Fetch/Web-IDL ultimately stringifies non-Request values. Never trust a convenient
    // .url/.href property when another valid URL representation points somewhere else:
    // an object such as {url:"https://example", toString(){return PROTECTED_FEED}}
    // previously looked benign to both wrappers but native fetch could still resolve it to
    // the protected feed. Ambiguous absolute URL identities therefore fail closed.
    for (const candidate of parsed) {
      if (candidate.url.href !== protectedCandidate.url.href) {
        fail("requestinfo_ambiguous_url");
      }
    }

    return { urlValue:protectedCandidate.value, identity:protectedCandidate.url };
  }

  function requestUrlValue(input) {
    return resolveRequestIdentity(input).urlValue;
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
    const resolved = resolveRequestIdentity(input);
    if (!resolved.identity) return guardedFetch(input, init);

    // Route every representation of a protected feed through the same string identity so
    // Feed Guard cannot be bypassed with new URL(), Request or Symbol.toPrimitive. Reject
    // obvious downgrade/credential/port/hash variants here too instead of treating them as
    // unrelated network traffic.
    assertProtectedTransport(resolved.identity);
    return guardedFetch(resolved.urlValue, normalizedProtectedInit(input, init));
  };

  globalThis.XAD_FEED_REQUESTINFO_GUARD = Object.freeze({
    requestUrlCandidates,
    requestUrlValue,
    protectedIdentity,
    resolveRequestIdentity,
    validLocalCacheBuster,
    assertProtectedTransport,
    normalizedProtectedInit
  });
})();
