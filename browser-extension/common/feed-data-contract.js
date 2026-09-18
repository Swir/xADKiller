(() => {
  if (globalThis.__xadFeedDataContractV1) return;
  globalThis.__xadFeedDataContractV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const ALLOWED_RESOURCE_TYPES = new Set([
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
    "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "other"
  ]);
  const APPROVED_PATHS = Object.freeze({
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json":"live-shield",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json":"live-matrix",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json":"titan"
  });

  function fail(reason) {
    throw new TypeError(`xad_feed_guard_${reason}`);
  }

  function guardedKind(urlValue) {
    const upstream = globalThis.XAD_FEED_TRANSPORT_GUARD?.guardedKind;
    if (typeof upstream === "function") return upstream(urlValue);
    let url;
    try { url = new URL(String(urlValue || "")); } catch (_) { return ""; }
    if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || url.port || url.username || url.password) return "";
    return APPROVED_PATHS[url.pathname] || "";
  }

  function isSafeText(value, maxLength) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= maxLength
      && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validDomain(value) {
    if (!isSafeText(value, 253) || value !== value.trim() || value !== value.toLowerCase()) return false;
    if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) return false;
    if (/[/:@*?\\\s]/.test(value)) return false;
    const labels = value.split(".");
    if (labels.length < 2) return false;
    return labels.every((label) => label.length >= 1 && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  }

  function validateDomainList(value, field, required = true) {
    if (value == null && !required) return;
    if (!Array.isArray(value)) fail(`${field}_array`);
    if (required && value.length === 0) fail(`${field}_empty`);
    const seen = new Set();
    for (const domain of value) {
      if (!validDomain(domain)) fail(`${field}_domain`);
      if (seen.has(domain)) fail(`${field}_duplicate`);
      seen.add(domain);
    }
  }

  function validTypes(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > ALLOWED_RESOURCE_TYPES.size) return false;
    const seen = new Set();
    for (const type of value) {
      if (typeof type !== "string" || !ALLOWED_RESOURCE_TYPES.has(type) || seen.has(type)) return false;
      seen.add(type);
    }
    return true;
  }

  function validateSignatureList(value, field, required = true) {
    if (value == null && !required) return;
    if (!Array.isArray(value)) fail(`${field}_array`);
    if (required && value.length === 0) fail(`${field}_empty`);
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${field}_object`);
      if (!isSafeText(item.filter, 512)) fail(`${field}_filter`);
      if (!validTypes(item.types)) fail(`${field}_types`);
      if (item.third_party !== undefined && typeof item.third_party !== "boolean") fail(`${field}_third_party`);
      for (const key of Object.keys(item)) {
        if (!["filter", "types", "third_party"].includes(key)) fail(`${field}_field`);
      }
    }
  }

  function validCosmeticSelector(value) {
    if (!isSafeText(value, 768) || value !== value.trim()) return false;
    if (/[{};]/.test(value) || /@(?:import|namespace|supports|media|layer|document)\b/i.test(value)) return false;
    if (/url\s*\(/i.test(value) || /expression\s*\(/i.test(value)) return false;
    return true;
  }

  function validateCosmeticList(value, field, required = true) {
    if (value == null && !required) return;
    if (!Array.isArray(value)) fail(`${field}_array`);
    if (required && value.length === 0) fail(`${field}_empty`);
    const seen = new Set();
    for (const selector of value) {
      if (!validCosmeticSelector(selector)) fail(`${field}_selector`);
      if (seen.has(selector)) fail(`${field}_duplicate`);
      seen.add(selector);
    }
  }

  function validateRegexList(value, field) {
    if (!Array.isArray(value) || value.length === 0) fail(`${field}_array`);
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${field}_object`);
      if (!isSafeText(item.regex, 768)) fail(`${field}_regex`);
      try { new RegExp(item.regex); } catch (_) { fail(`${field}_regex`); }
      if (!validTypes(item.types)) fail(`${field}_types`);
      if (item.third_party !== undefined && typeof item.third_party !== "boolean") fail(`${field}_third_party`);
      for (const key of Object.keys(item)) {
        if (!["regex", "types", "third_party"].includes(key)) fail(`${field}_field`);
      }
    }
  }

  function validateStringList(value, field, validator, required = true) {
    if (value == null && !required) return;
    if (!Array.isArray(value)) fail(`${field}_array`);
    if (required && value.length === 0) fail(`${field}_empty`);
    const seen = new Set();
    for (const item of value) {
      if (!validator(item)) fail(`${field}_value`);
      if (seen.has(item)) fail(`${field}_duplicate`);
      seen.add(item);
    }
  }

  function validatePayload(kind, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("payload_object");

    if (kind === "live-shield") {
      validateDomainList(data.standard_domains, "standard_domains");
      validateDomainList(data.ultra_domains, "ultra_domains", false);
      return data;
    }
    if (kind === "live-matrix") {
      validateDomainList(data.standard_domains, "standard_domains", false);
      validateDomainList(data.ultra_domains, "ultra_domains", false);
      validateSignatureList(data.standard_signatures, "standard_signatures");
      validateSignatureList(data.ultra_signatures, "ultra_signatures", false);
      validateCosmeticList(data.standard_cosmetic, "standard_cosmetic");
      validateCosmeticList(data.ultra_cosmetic, "ultra_cosmetic", false);
      return data;
    }
    if (kind === "titan") {
      validateRegexList(data.regex_signatures, "regex_signatures");
      validateStringList(data.path_signatures, "path_signatures",
        (item) => isSafeText(item, 256) && item === item.trim() && item.startsWith("/") && !/[{}\s]/.test(item), false);
      validateStringList(data.strong_tokens, "strong_tokens",
        (item) => isSafeText(item, 96) && item === item.trim() && item === item.toLowerCase() && /^[a-z0-9._-]+$/.test(item), false);
      return data;
    }
    fail("payload_kind");
  }

  async function parseAndValidate(kind, response) {
    if (!response?.ok) return response;
    const text = await response.clone().text();
    if (!text || text.length > MAX_FEED_BYTES) fail("payload_size");
    let data;
    try { data = JSON.parse(text); } catch (_) { fail("json"); }
    validatePayload(kind, data);
    return response;
  }

  globalThis.fetch = async (input, init) => {
    const urlValue = typeof input === "string" ? input : input?.url;
    const kind = guardedKind(urlValue);
    if (!kind) return nativeFetch(input, init);
    const response = await nativeFetch(input, init);
    return parseAndValidate(kind, response);
  };

  globalThis.XAD_FEED_DATA_CONTRACT = Object.freeze({
    guardedKind,
    validDomain,
    validTypes,
    validCosmeticSelector,
    validatePayload
  });
})();
