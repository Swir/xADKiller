(() => {
  if (globalThis.__xadFeedRollbackProvenanceV1) return;
  globalThis.__xadFeedRollbackProvenanceV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const RAW_HOST = "raw.githubusercontent.com";
  const APPROVED_PATHS = Object.freeze({
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json":"live-shield",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json":"live-matrix",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json":"titan"
  });
  const APPROVED_ROLLBACK_REFS = Object.freeze({
    "live-shield":"live-shield-feed/browser-intelligence/xadkiller-live-shield.json",
    "live-matrix":"main/browser-intelligence/xadkiller-live-shield.json",
    "titan":"main/browser-intelligence/xadkiller-titan-feed.json"
  });

  function fail(reason) {
    throw new TypeError(`xad_feed_guard_${reason}`);
  }

  function guardedKind(urlValue) {
    const upstream = globalThis.XAD_FEED_TRANSPORT_GUARD?.guardedKind;
    if (typeof upstream === "function") return upstream(urlValue);
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return ""; }
    if (url.protocol !== "https:" || url.hostname !== RAW_HOST || url.port || url.username || url.password || url.hash) return "";
    if (url.search) {
      const params = [...url.searchParams.entries()];
      if (params.length !== 1 || params[0][0] !== "v" || !/^\d{10,16}$/.test(params[0][1])) return "";
    }
    return APPROVED_PATHS[url.pathname] || "";
  }

  function validateRollbackProvenance(kind, data) {
    if (!data || data.schema !== 2) return true;
    const rollback = data.rollback;
    if (!rollback || typeof rollback !== "object" || Array.isArray(rollback)) fail("rollback");
    const expected = APPROVED_ROLLBACK_REFS[kind] || "";
    const actual = String(rollback.previous_ref || "").trim();
    if (!expected || actual !== expected) fail("rollback_provenance");
    return true;
  }

  async function validateResponse(kind, response) {
    if (!response?.ok) return response;
    const text = await response.clone().text();
    let data;
    try { data = JSON.parse(text); } catch (_) { fail("json"); }
    validateRollbackProvenance(kind, data);
    return response;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);
    const response = await nativeFetch(input, init);
    return validateResponse(kind, response);
  };

  globalThis.XAD_FEED_ROLLBACK_PROVENANCE = Object.freeze({
    APPROVED_ROLLBACK_REFS,
    guardedKind,
    validateRollbackProvenance
  });
})();
