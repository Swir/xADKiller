let uiLanguage = "en";
let uiMessages = {};

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, (value) => resolve(value || defaults)));
}
function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}
function t(key, fallback) {
  return uiMessages[key] || chrome.i18n.getMessage(key) || fallback || key;
}
function formatNumber(value) {
  return Number(value || 0).toLocaleString(uiLanguage === "pl" ? "pl-PL" : "en-US");
}
function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok:false, error:chrome.runtime.lastError.message });
      else resolve(response || { ok:false });
    });
  });
}
function currentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active:true, currentWindow:true }, (tabs) => resolve(tabs?.[0] || null));
  });
}
function tabMessage(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(null);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null); else resolve(response || null);
    });
  });
}
function applyI18n() {
  document.documentElement.lang = uiLanguage;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const value = t(key, el.textContent);
    if (value) el.textContent = value;
  });
  const languageEl = document.getElementById("language");
  if (languageEl) languageEl.value = uiLanguage;
}
async function loadLanguage(lang) {
  const safe = lang === "pl" ? "pl" : "en";
  let loaded = {};
  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${safe}/messages.json`), { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    for (const [key, entry] of Object.entries(raw || {})) {
      if (typeof entry?.message === "string" && entry.message) loaded[key] = entry.message;
    }
  } catch (_) {
    loaded = {};
  }
  uiLanguage = safe;
  uiMessages = loaded;
  applyI18n();
}
async function initializeLanguage() {
  const stored = await storageGet({ uiLanguage:"" });
  const remembered = stored.uiLanguage === "pl" || stored.uiLanguage === "en" ? stored.uiLanguage : "";
  const chromeLanguage = String(chrome.i18n.getUILanguage?.() || "").toLowerCase();
  const detected = chromeLanguage === "pl" || chromeLanguage.startsWith("pl-") ? "pl" : "en";
  await loadLanguage(remembered || detected);
}

const enabledEl = document.getElementById("enabled");
const modeEl = document.getElementById("mode");
const languageEl = document.getElementById("language");
const smartEl = document.getElementById("smartEnabled");
const autoSkipEl = document.getElementById("autoSkip");
const statusText = document.getElementById("statusText");
const hostEl = document.getElementById("host");
const siteToggle = document.getElementById("siteToggle");
const tempPauseBtn = document.getElementById("tempPauseBtn");
const tempPauseInfo = document.getElementById("tempPauseInfo");
const heuristicRecoveryBtn = document.getElementById("heuristicRecoveryBtn");
const heuristicRecoveryInfo = document.getElementById("heuristicRecoveryInfo");
const pauseBadge = document.getElementById("pauseBadge");
const networkCount = document.getElementById("networkCount");
const hiddenCount = document.getElementById("hiddenCount");
const smartCount = document.getElementById("smartCount");
const learnedCount = document.getElementById("learnedCount");
const rulesInfo = document.getElementById("rulesInfo");
const customInfo = document.getElementById("customInfo");
const domainInput = document.getElementById("domainInput");
const liveInfo = document.getElementById("liveInfo");
const liveRefresh = document.getElementById("liveRefresh");
const titanInfo = document.getElementById("titanInfo");
const memoryBadge = document.getElementById("memoryBadge");
const memoryInfo = document.getElementById("memoryInfo");
const resetMemoryBtn = document.getElementById("resetMemoryBtn");
const clearRecoveryHistoryBtn = document.getElementById("clearRecoveryHistoryBtn");
const recoveryHistoryInfo = document.getElementById("recoveryHistoryInfo");

let activeTab = null;
let host = "";
let siteAllowed = false;
let temporaryPaused = false;
let temporaryMinutesLeft = 0;
let heuristicRecoveryActive = false;
let heuristicRecoveryMinutesLeft = 0;
let rollbackHistoryCount = 0;
let protectionEnabled = true;
let stateBusy = false;
let languageBusy = false;

function renderMemory(titan) {
  if (!titan?.ok) {
    memoryBadge.textContent = "—";
    memoryBadge.className = "memoryBadge off";
    memoryInfo.textContent = t("adaptiveHint", "Everything is learned locally in this browser profile.");
    return;
  }
  const remembered = Number(titan.memory || 0);
  const promoted = Number(titan.promoted || 0);
  const ttl = Number(titan.memoryTtlDays || 21);
  memoryBadge.textContent = formatNumber(promoted);
  memoryBadge.className = promoted > 0 ? "memoryBadge hot" : "memoryBadge";
  memoryBadge.title = `${t("adaptiveMemory", "Adaptive Memory")}: ${formatNumber(promoted)}`;
  memoryInfo.textContent = `${t("adaptiveMemory", "Adaptive Memory")}: ${formatNumber(remembered)} ${t("memoryRemembered", "remembered")} • ${formatNumber(promoted)} ${t("memoryPromoted", "promoted")} • ${ttl} ${t("memoryDays", "days")}`;
}

function renderSiteControls() {
  const usable = !!host;
  const persistentAllowed = siteAllowed && !temporaryPaused;
  siteToggle.disabled = !usable || temporaryPaused;
  siteToggle.textContent = persistentAllowed ? t("protectSite", "Protect this site") : t("allowSite", "Allow this site");

  tempPauseBtn.disabled = !usable || persistentAllowed || !protectionEnabled;
  tempPauseBtn.textContent = temporaryPaused ? t("resumeSiteNow", "Resume now") : t("pauseSite15", "Pause 15 min");
  tempPauseBtn.className = temporaryPaused ? "secondary warningButton active" : "secondary warningButton";

  heuristicRecoveryBtn.disabled = !usable || persistentAllowed || !protectionEnabled || temporaryPaused;
  heuristicRecoveryBtn.textContent = heuristicRecoveryActive ? t("heuristicRecoveryStop", "Restore heuristics now") : t("heuristicRecovery15", "Try safe recovery 15 min");
  heuristicRecoveryBtn.className = heuristicRecoveryActive ? "secondary warningButton active memoryAction" : "secondary memoryAction";

  if (!usable) {
    pauseBadge.textContent = t("siteUnavailable", "N/A");
    pauseBadge.className = "pauseBadge off";
    tempPauseInfo.textContent = t("pauseUnsupported", "Temporary pause is available on normal HTTP/HTTPS websites.");
    heuristicRecoveryInfo.textContent = t("heuristicRecoveryUnsupported", "Safe recovery is available on normal HTTP/HTTPS websites.");
  } else if (temporaryPaused) {
    pauseBadge.textContent = t("sitePaused", "PAUSED");
    pauseBadge.className = "pauseBadge paused";
    tempPauseInfo.textContent = `${t("pauseActive", "Protection temporarily paused")} • ${formatNumber(temporaryMinutesLeft)} ${t("minutesLeft", "min left")}`;
    heuristicRecoveryInfo.textContent = t("heuristicRecoveryEscalated", "Full site pause is active; core network filtering is also bypassed for this site.");
  } else if (persistentAllowed) {
    pauseBadge.textContent = t("siteAllowedStatus", "ALLOWED");
    pauseBadge.className = "pauseBadge paused";
    tempPauseInfo.textContent = t("persistentAllowHint", "This site is on your permanent allowlist. Re-enable protection to use temporary pause.");
    heuristicRecoveryInfo.textContent = t("heuristicRecoveryAllowed", "The permanent allowlist already bypasses protection for this site.");
  } else if (!protectionEnabled) {
    pauseBadge.textContent = t("statusOff", "DISABLED");
    pauseBadge.className = "pauseBadge off";
    tempPauseInfo.textContent = t("globalProtectionOffHint", "Global protection is disabled.");
    heuristicRecoveryInfo.textContent = t("heuristicRecoveryGlobalOff", "Enable global protection before using safe recovery.");
  } else if (heuristicRecoveryActive) {
    pauseBadge.textContent = t("heuristicRecoveryStatus", "RECOVERY");
    pauseBadge.className = "pauseBadge paused";
    tempPauseInfo.textContent = t("pauseSiteHint", "Temporary pause is for fixing a broken site and resumes automatically.");
    heuristicRecoveryInfo.textContent = `${t("heuristicRecoveryActive", "Heuristic layers paused; core network rules remain enabled")} • ${formatNumber(heuristicRecoveryMinutesLeft)} ${t("minutesLeft", "min left")}`;
  } else {
    pauseBadge.textContent = t("siteProtected", "PROTECTED");
    pauseBadge.className = "pauseBadge off";
    tempPauseInfo.textContent = t("pauseSiteHint", "Temporary pause is for fixing a broken site and resumes automatically.");
    heuristicRecoveryInfo.textContent = t("heuristicRecoveryHint", "Safe recovery pauses local heuristic layers first while core network rules stay enabled.");
  }
  recoveryHistoryInfo.textContent = rollbackHistoryCount > 0
    ? `${t("recoveryHistory", "Local recovery history")}: ${formatNumber(rollbackHistoryCount)} ${t("events", "events")}`
    : t("recoveryHistoryHint", "Breakage Guard history stays local and contains only bounded recovery events.");
  clearRecoveryHistoryBtn.disabled = rollbackHistoryCount <= 0;
}

async function refresh() {
  activeTab = await currentTab();
  host = "";
  try { if (activeTab && /^https?:/i.test(activeTab.url || "")) host = new URL(activeTab.url).hostname; } catch (_) {}
  hostEl.textContent = host || t("unsupportedPage", "Browser page");

  const [state, pause, recovery, history] = await Promise.all([
    send({ type:"getState", host }),
    host ? send({ type:"getTemporarySitePause", host }) : Promise.resolve({ ok:true, paused:false, minutesLeft:0 }),
    host ? send({ type:"getHeuristicSiteRecovery", host }) : Promise.resolve({ ok:true, active:false, minutesLeft:0 }),
    send({ type:"getBreakageRollbackHistory" })
  ]);
  temporaryPaused = !!pause?.paused;
  temporaryMinutesLeft = Number(pause?.minutesLeft || 0);
  heuristicRecoveryActive = !!recovery?.active;
  heuristicRecoveryMinutesLeft = Number(recovery?.minutesLeft || 0);
  rollbackHistoryCount = Array.isArray(history?.items) ? history.items.length : 0;

  if (state?.ok) {
    protectionEnabled = !!state.enabled;
    enabledEl.checked = protectionEnabled;
    modeEl.value = state.mode === "ultra" ? "ultra" : "standard";
    smartEl.checked = !!state.smartEnabled;
    autoSkipEl.checked = !!state.autoSkip;
    siteAllowed = !!state.siteAllowed;
    statusText.textContent = state.enabled ? t("statusOn", "ACTIVE") : t("statusOff", "DISABLED");
    const b = state.build;
    if (b) {
      const total = state.mode === "ultra" ? Number(b.standardRules || 0) + Number(b.ultraRules || 0) : Number(b.standardRules || 0);
      rulesInfo.textContent = `${formatNumber(total)} ${t("networkRules", "network rules")} • ${formatNumber(b.cosmeticGeneric || 0)}+ ${t("cosmeticRules", "cosmetic rules")}`;
    }
    customInfo.textContent = `${formatNumber((state.customDomains || []).length)} ${t("customDomainsCount", "custom domains")}`;
    const live = state.liveShield || {};
    if (live.version) {
      const count = state.mode === "ultra" ? Number(live.standard || 0) + Number(live.ultra || 0) : Number(live.standard || 0);
      liveInfo.textContent = `${live.version} • ${formatNumber(count)} ${t("liveDomains", "live domains")}`;
    } else {
      liveInfo.textContent = t("liveShieldWaiting", "Waiting for intelligence feed…");
    }
  }
  renderSiteControls();

  const [shield, matrix, titan] = await Promise.all([
    send({ type:"getDynamicShieldStats" }),
    send({ type:"getLiveMatrixStats" }),
    send({ type:"getTitanStats" })
  ]);
  if (shield?.ok && rulesInfo.textContent !== "—") {
    const dynamicTotal = Number(shield.total || 0) + Number(matrix?.signatures || 0) + Number(titan?.regex || 0);
    rulesInfo.textContent += ` • ${formatNumber(dynamicTotal)} ${t("dynamicRules", "dynamic")}`;
  }
  if (matrix?.ok && matrix.version) {
    const cosmetic = modeEl.value === "ultra" ? Number(matrix.cosmeticStandard || 0) + Number(matrix.cosmeticUltra || 0) : Number(matrix.cosmeticStandard || 0);
    liveInfo.textContent += ` • ${formatNumber(matrix.signatures || 0)} ${t("signaturesShort", "sig")} • ${formatNumber(cosmetic)} ${t("cssShort", "CSS")}`;
  }
  if (titan?.ok) {
    titanInfo.textContent = `${formatNumber(titan.session || 0)} ${t("sessionRules", "session")} • ${formatNumber(titan.regex || 0)} ${t("regexRules", "regex")} • ${formatNumber(titan.learned || 0)} ${t("learnedRules", "learned")}${titan.version ? ` • ${titan.version}` : ""}`;
  } else {
    titanInfo.textContent = t("titanWaiting", "TITAN engine waiting…");
  }
  renderMemory(titan);

  const stats = activeTab ? await tabMessage(activeTab.id, { type:"getPageStats" }) : null;
  hiddenCount.textContent = Number.isFinite(stats?.hidden) ? formatNumber(stats.hidden) : "0";
  smartCount.textContent = Number.isFinite(stats?.smart) ? formatNumber(stats.smart) : "0";
  learnedCount.textContent = Number.isFinite(stats?.learned) ? formatNumber(stats.learned) : "0";
  const net = activeTab ? await send({ type:"getNetworkStats", tabId:activeTab.id }) : null;
  networkCount.textContent = Number.isFinite(net?.count) ? formatNumber(net.count) : "0";
}

async function rescan() {
  if (activeTab) await tabMessage(activeTab.id, { type:"rescan" });
}

languageEl.addEventListener("change", async () => {
  if (languageBusy) return;
  languageBusy = true;
  const next = languageEl.value === "pl" ? "pl" : "en";
  await storageSet({ uiLanguage:next });
  await loadLanguage(next);
  await refresh();
  languageBusy = false;
});
enabledEl.addEventListener("change", async () => {
  if (stateBusy) return;
  stateBusy = true;
  await send({ type:"setEnabled", enabled:enabledEl.checked });
  await rescan();
  stateBusy = false;
  refresh();
});
modeEl.addEventListener("change", async () => {
  if (stateBusy) return;
  stateBusy = true;
  await send({ type:"setMode", mode:modeEl.value });
  await rescan();
  stateBusy = false;
  refresh();
});
smartEl.addEventListener("change", async () => {
  await send({ type:"setSmartEnabled", smartEnabled:smartEl.checked });
  await rescan();
});
autoSkipEl.addEventListener("change", async () => {
  await send({ type:"setAutoSkip", autoSkip:autoSkipEl.checked });
  await rescan();
});
siteToggle.addEventListener("click", async () => {
  if (!host || stateBusy || temporaryPaused) return;
  stateBusy = true;
  await send({ type:"setSiteAllowed", host, allowed:!siteAllowed });
  await rescan();
  stateBusy = false;
  refresh();
});
heuristicRecoveryBtn.addEventListener("click", async () => {
  if (!host || stateBusy) return;
  stateBusy = true;
  heuristicRecoveryBtn.disabled = true;
  const result = await send({ type:"setHeuristicSiteRecovery", host, minutes:heuristicRecoveryActive ? 0 : 15 });
  if (result?.ok) {
    await rescan();
    try { if (activeTab?.id) chrome.tabs.reload(activeTab.id); } catch (_) {}
  }
  stateBusy = false;
  refresh();
});
tempPauseBtn.addEventListener("click", async () => {
  if (!host || stateBusy) return;
  stateBusy = true;
  tempPauseBtn.disabled = true;
  const result = await send({ type:"setTemporarySitePause", host, minutes:temporaryPaused ? 0 : 15 });
  if (result?.ok) {
    await rescan();
    try { if (activeTab?.id) chrome.tabs.reload(activeTab.id); } catch (_) {}
  }
  stateBusy = false;
  refresh();
});
liveRefresh.addEventListener("click", async () => {
  if (stateBusy) return;
  stateBusy = true;
  liveRefresh.disabled = true;
  liveInfo.textContent = t("liveShieldUpdating", "Updating Live Shield…");
  const [domains, matrix, titan] = await Promise.all([
    send({ type:"refreshLiveShield" }),
    send({ type:"refreshLiveMatrix" }),
    send({ type:"refreshTitan" })
  ]);
  if (!domains?.ok || !matrix?.ok || !titan?.ok) {
    liveInfo.textContent = `${t("liveShieldError", "Update failed")}: ${domains?.error || matrix?.error || titan?.error || "unknown"}`;
  }
  stateBusy = false;
  liveRefresh.disabled = false;
  refresh();
});
document.getElementById("pickerBtn").addEventListener("click", async () => {
  if (activeTab) await tabMessage(activeTab.id, { type:"startPicker" });
  window.close();
});
document.getElementById("falseBtn").addEventListener("click", async () => {
  if (activeTab) await tabMessage(activeTab.id, { type:"markFalsePositive" });
  setTimeout(refresh, 120);
});
resetMemoryBtn.addEventListener("click", async () => {
  if (stateBusy) return;
  const ok = confirm(t("resetMemoryConfirm", "Clear TITAN Adaptive Memory? Current filter lists and your custom domains will not be removed."));
  if (!ok) return;
  stateBusy = true;
  resetMemoryBtn.disabled = true;
  await send({ type:"resetTitanMemory" });
  resetMemoryBtn.disabled = false;
  stateBusy = false;
  refresh();
});
clearRecoveryHistoryBtn.addEventListener("click", async () => {
  if (stateBusy || rollbackHistoryCount <= 0) return;
  stateBusy = true;
  clearRecoveryHistoryBtn.disabled = true;
  await send({ type:"clearBreakageRollbackHistory" });
  stateBusy = false;
  refresh();
});
document.getElementById("addDomainBtn").addEventListener("click", async () => {
  const domain = domainInput.value.trim();
  if (!domain) return;
  const result = await send({ type:"addCustomDomain", domain });
  if (result?.ok) domainInput.value = "";
  refresh();
});
domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addDomainBtn").click();
});
document.getElementById("testBtn").addEventListener("click", () => {
  chrome.tabs.create({ url:"https://superadblocktest.com/" });
});
document.getElementById("githubBtn").addEventListener("click", () => {
  chrome.tabs.create({ url:"https://github.com/Swir/xADKiller" });
});

async function init() {
  await initializeLanguage();
  await refresh();
  setInterval(() => { if (temporaryPaused || heuristicRecoveryActive) refresh(); }, 30000);
}
init();