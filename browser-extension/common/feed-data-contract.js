(() => {
  if (globalThis.__xadFeedDataContractV1) return;
  globalThis.__xadFeedDataContractV1 = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const MAX_FEED_BYTES = 2 * 1024 * 1024;
  const MAX_DOMAINS_PER_LIST = 30_000;
  const MAX_SIGNATURES_PER_LIST = 10_000;
  const MAX_COSMETIC_PER_LIST = 20_000;
  const MAX_REGEX_PER_LIST = 2_000;
  const MAX_PATHS_PER_LIST = 10_000;
  const MAX_TOKENS_PER_LIST = 10_000;
  const ALLOWED_RESOURCE_TYPES = new Set([
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
    "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "other"
  ]);
  const APPROVED_PATHS = Object.freeze({
    "/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json":"live-shield",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json":"live-matrix",
    "/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json":"titan"
  });
  const COMMON_TOP_LEVEL_FIELDS = Object.freeze([
    "schema", "feed", "feed_version", "updated_at", "expires_at", "rollback", "maintainer", "description"
  ]);
  const PAYLOAD_FIELDS = Object.freeze({
    "live-shield":["standard_domains", "ultra_domains"],
    "live-matrix":["standard_domains", "ultra_domains", "standard_signatures", "ultra_signatures", "standard_cosmetic", "ultra_cosmetic"],
    "titan":["regex_signatures", "path_signatures", "strong_tokens"]
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

  function validateTopLevelShape(kind, data) {
    const payloadFields = PAYLOAD_FIELDS[kind];
    if (!payloadFields) fail("payload_kind");
    const allowed = new Set([...COMMON_TOP_LEVEL_FIELDS, ...payloadFields]);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) fail("payload_field");
    }

    if (data.schema !== 1 && data.schema !== 2) fail("schema");
    if (data.feed !== undefined && !isSafeText(data.feed, 160)) fail("feed_name");
    if (data.maintainer !== undefined && !isSafeText(data.maintainer, 160)) fail("maintainer");
    if (data.description !== undefined && !isSafeText(data.description, 1024)) fail("description");

    if (data.schema === 1) {
      if (data.expires_at !== undefined || data.rollback !== undefined) fail("v1_metadata");
      return;
    }

    if (!isSafeText(data.expires_at, 80) || !data.rollback || typeof data.rollback !== "object" || Array.isArray(data.rollback)) {
      fail("v2_metadata");
    }
    const rollbackKeys = Object.keys(data.rollback);
    if (rollbackKeys.length !== 2 || !rollbackKeys.includes("previous_version") || !rollbackKeys.includes("previous_ref")) {
      fail("rollback_field");
    }
    if (!isSafeText(data.rollback.previous_version, 80) || !isSafeText(data.rollback.previous_ref, 160)) {
      fail("rollback_value");
    }
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

  function validateArray(value, field, required, maxItems) {
    if (value == null && !required) return false;
    if (!Array.isArray(value)) fail(`${field}_array`);
    if (required && value.length === 0) fail(`${field}_empty`);
    if (value.length > maxItems) fail(`${field}_limit`);
    return true;
  }

  function validateDomainList(value, field, required = true) {
    if (!validateArray(value, field, required, MAX_DOMAINS_PER_LIST)) return;
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

  function semanticRuleKey(pattern, types, thirdParty) {
    return `${pattern}\n${[...types].sort().join(",")}\n${thirdParty === true ? "1" : "0"}`;
  }

  function validateSignatureList(value, field, required = true) {
    if (!validateArray(value, field, required, MAX_SIGNATURES_PER_LIST)) return;
    const seen = new Set();
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${field}_object`);
      if (!isSafeText(item.filter, 512)) fail(`${field}_filter`);
      if (!validTypes(item.types)) fail(`${field}_types`);
      if (item.third_party !== undefined && typeof item.third_party !== "boolean") fail(`${field}_third_party`);
      for (const key of Object.keys(item)) {
        if (!["filter", "types", "third_party"].includes(key)) fail(`${field}_field`);
      }
      const key = semanticRuleKey(item.filter, item.types, item.third_party);
      if (seen.has(key)) fail(`${field}_duplicate`);
      seen.add(key);
    }
  }

  function validCosmeticSelector(value) {
    if (!isSafeText(value, 768) || value !== value.trim()) return false;
    if (/[{};]/.test(value) || /@(?:import|namespace|supports|media|layer|document)\b/i.test(value)) return false;
    if (/url\s*\(/i.test(value) || /expression\s*\(/i.test(value)) return false;
    return true;
  }

  function validateCosmeticList(value, field, required = true) {
    if (!validateArray(value, field, required, MAX_COSMETIC_PER_LIST)) return;
    const seen = new Set();
    for (const selector of value) {
      if (!validCosmeticSelector(selector)) fail(`${field}_selector`);
      if (seen.has(selector)) fail(`${field}_duplicate`);
      seen.add(selector);
    }
  }

  function readQuantifier(source, index) {
    const ch = source[index];
    if (ch === "*" || ch === "+") return { end:index + 1, unbounded:true };
    if (ch === "?") return { end:index + 1, unbounded:false };
    if (ch !== "{") return null;
    const close = source.indexOf("}", index + 1);
    if (close < 0 || close - index > 16) return null;
    const body = source.slice(index + 1, close);
    if (!/^\d+(?:,\d*)?$/.test(body)) return null;
    const comma = body.indexOf(",");
    const unbounded = comma >= 0 && comma === body.length - 1;
    return { end:close + 1, unbounded };
  }

  function hasUnsafeRegexStructure(source) {
    if (/\\(?:[1-9]|k<)/.test(source)) return true;
    const stack = [];
    let escaped = false;
    let inClass = false;
    let lastClosedGroup = null;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (escaped) { escaped = false; lastClosedGroup = null; continue; }
      if (ch === "\\") { escaped = true; lastClosedGroup = null; continue; }
      if (inClass) {
        if (ch === "]") inClass = false;
        continue;
      }
      if (ch === "[") { inClass = true; lastClosedGroup = null; continue; }
      if (ch === "(") { stack.push({ hasUnbounded:false }); lastClosedGroup = null; continue; }
      if (ch === ")") {
        lastClosedGroup = stack.pop() || { hasUnbounded:false };
        continue;
      }

      const quantifier = readQuantifier(source, i);
      if (quantifier) {
        if (lastClosedGroup?.hasUnbounded && quantifier.unbounded) return true;
        if (quantifier.unbounded) {
          for (const group of stack) group.hasUnbounded = true;
        }
        i = quantifier.end - 1;
        lastClosedGroup = null;
        continue;
      }
      if (!/\s/.test(ch)) lastClosedGroup = null;
    }
    return false;
  }

  function validRegexPattern(value) {
    if (!isSafeText(value, 768)) return false;
    try { new RegExp(value); } catch (_) { return false; }
    return !hasUnsafeRegexStructure(value);
  }

  function validateRegexList(value, field) {
    if (!validateArray(value, field, true, MAX_REGEX_PER_LIST)) return;
    const seen = new Set();
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${field}_object`);
      if (!isSafeText(item.regex, 768)) fail(`${field}_regex`);
      try { new RegExp(item.regex); } catch (_) { fail(`${field}_regex`); }
      if (hasUnsafeRegexStructure(item.regex)) fail(`${field}_regex_unsafe`);
      if (!validTypes(item.types)) fail(`${field}_types`);
      if (item.third_party !== undefined && typeof item.third_party !== "boolean") fail(`${field}_third_party`);
      for (const key of Object.keys(item)) {
        if (!["regex", "types", "third_party"].includes(key)) fail(`${field}_field`);
      }
      const key = semanticRuleKey(item.regex, item.types, item.third_party);
      if (seen.has(key)) fail(`${field}_duplicate`);
      seen.add(key);
    }
  }

  function validateStringList(value, field, validator, required = true, maxItems = MAX_PATHS_PER_LIST) {
    if (!validateArray(value, field, required, maxItems)) return;
    const seen = new Set();
    for (const item of value) {
      if (!validator(item)) fail(`${field}_value`);
      if (seen.has(item)) fail(`${field}_duplicate`);
      seen.add(item);
    }
  }

  function validatePayload(kind, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("payload_object");
    validateTopLevelShape(kind, data);

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
        (item) => isSafeText(item, 256) && item === item.trim() && item.startsWith("/") && !/[{}\s]/.test(item), false, MAX_PATHS_PER_LIST);
      validateStringList(data.strong_tokens, "strong_tokens",
        (item) => isSafeText(item, 96) && item === item.trim() && item === item.toLowerCase() && /^[a-z0-9._-]+$/.test(item), false, MAX_TOKENS_PER_LIST);
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
    validRegexPattern,
    validatePayload
  });
})();
