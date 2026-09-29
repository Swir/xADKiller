const HIGH_VALUE_RESOURCE_TYPES = new Set([
  "script",
  "xmlhttprequest",
  "sub_frame",
  "image",
  "media",
  "websocket"
]);

function sortedStrings(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))].sort() : [];
}

export function agreementKey(parsed) {
  if (!parsed || !parsed.condition) return "";
  const condition = parsed.condition;
  return JSON.stringify({
    action: parsed.action || "",
    urlFilter: condition.urlFilter || "",
    domainType: condition.domainType || "",
    initiatorDomains: sortedStrings(condition.initiatorDomains),
    excludedInitiatorDomains: sortedStrings(condition.excludedInitiatorDomains),
    isUrlFilterCaseSensitive: condition.isUrlFilterCaseSensitive === true
  });
}

export function registerSourceAgreement(map, parsed, sourceId) {
  const key = agreementKey(parsed);
  if (!key || !sourceId) return;
  let sources = map.get(key);
  if (!sources) {
    sources = new Set();
    map.set(key, sources);
  }
  sources.add(String(sourceId));
}

export function sourceAgreementCount(map, parsed) {
  const key = agreementKey(parsed);
  if (!key) return 1;
  return Math.max(1, map.get(key)?.size || 1);
}

export function resourceCoverageScore(parsed) {
  const condition = parsed?.condition || {};
  const types = sortedStrings(condition.resourceTypes);
  if (!types.length) return 0;

  let highValue = 0;
  for (const type of types) if (HIGH_VALUE_RESOURCE_TYPES.has(type)) highValue++;

  // Reward useful request coverage, but keep broad substring filters conservative.
  let score = Math.min(18, highValue * 3);
  const filter = String(condition.urlFilter || "");
  const anchoredDomain = filter.startsWith("||");
  const constrained = condition.domainType === "thirdParty"
    || sortedStrings(condition.initiatorDomains).length > 0;
  if (!anchoredDomain && !constrained && types.length >= 8) score = Math.min(score, 3);
  return score;
}

export function qualityBoost(parsed, agreementCount) {
  const agreementBonus = Math.min(72, Math.max(0, agreementCount - 1) * 24);
  return agreementBonus + resourceCoverageScore(parsed);
}

export function agreementSummary(map) {
  let multiSourceSignals = 0;
  let maxSourceAgreement = 1;
  for (const sources of map.values()) {
    const count = sources.size;
    if (count >= 2) multiSourceSignals++;
    if (count > maxSourceAgreement) maxSourceAgreement = count;
  }
  return {
    signals: map.size,
    multiSourceSignals,
    maxSourceAgreement
  };
}
