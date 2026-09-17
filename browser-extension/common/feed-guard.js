(() => {
  if (globalThis.__xadFeedGuardV1) return;
  globalThis.__xadFeedGuardV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const LIVE_SHIELD_PATH = "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
  const LIVE_MATRIX_PATH = "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
  const TITAN_PATH = "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";

  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
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
    if (!response?.ok) return;
    const data = await parseProtectedResponse(response);
    if (kind === "live-shield") await validateLiveShield(data);
    else if (kind === "live-matrix") await validateLiveMatrix(data);
    else if (kind === "titan") await validateTitan(data);
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    const response = await nativeFetch(input, init);
    if (kind) await validate(kind, response);
    return response;
  };

  globalThis.XAD_FEED_GUARD = Object.freeze({ guardedKind, validVersion, minRelative });
})();
