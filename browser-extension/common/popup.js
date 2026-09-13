function t(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback || key;
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
document.querySelectorAll("[data-i18n]").forEach((el) => {
  const key = el.getAttribute("data-i18n");
  const value = t(key, el.textContent);
  if (value) el.textContent = value;
});

const enabledEl = document.getElementById("enabled");
const modeEl = document.getElementById("mode");
const smartEl = document.getElementById("smartEnabled");
const autoSkipEl = document.getElementById("autoSkip");
const statusText = document.getElementById("statusText");
const hostEl = document.getElementById("host");
const siteToggle = document.getElementById("siteToggle");
const networkCount = document.getElementById("networkCount");
const hiddenCount = document.getElementById("hiddenCount");
const smartCount = document.getElementById("smartCount");
const learnedCount = document.getElementById("learnedCount");
const rulesInfo = document.getElementById("rulesInfo");
const customInfo = document.getElementById("customInfo");
const domainInput = document.getElementById("domainInput");

let activeTab = null;
let host = "";
let siteAllowed = false;
let stateBusy = false;

async function refresh() {
  activeTab = await currentTab();
  host = "";
  try { if (activeTab && /^https?:/i.test(activeTab.url || "")) host = new URL(activeTab.url).hostname; } catch (_) {}
  hostEl.textContent = host || t("unsupportedPage", "Browser page");

  const state = await send({ type:"getState", host });
  if (state?.ok) {
    enabledEl.checked = !!state.enabled;
    modeEl.value = state.mode === "ultra" ? "ultra" : "standard";
    smartEl.checked = !!state.smartEnabled;
    autoSkipEl.checked = !!state.autoSkip;
    siteAllowed = !!state.siteAllowed;
    statusText.textContent = state.enabled ? t("statusOn", "ACTIVE") : t("statusOff", "DISABLED");
    siteToggle.disabled = !host;
    siteToggle.textContent = siteAllowed ? t("protectSite", "Protect this site") : t("allowSite", "Allow this site");
    const b = state.build;
    if (b) {
      const total = state.mode === "ultra" ? Number(b.standardRules || 0) + Number(b.ultraRules || 0) : Number(b.standardRules || 0);
      rulesInfo.textContent = `${total.toLocaleString()} ${t("networkRules", "network rules")} • ${(b.cosmeticGeneric || 0).toLocaleString()}+ ${t("cosmeticRules", "cosmetic rules")}`;
    }
    customInfo.textContent = `${(state.customDomains || []).length} ${t("customDomainsCount", "custom domains")}`;
  }

  const stats = activeTab ? await tabMessage(activeTab.id, { type:"getPageStats" }) : null;
  hiddenCount.textContent = Number.isFinite(stats?.hidden) ? stats.hidden : "0";
  smartCount.textContent = Number.isFinite(stats?.smart) ? stats.smart : "0";
  learnedCount.textContent = Number.isFinite(stats?.learned) ? stats.learned : "0";
  const net = activeTab ? await send({ type:"getNetworkStats", tabId:activeTab.id }) : null;
  networkCount.textContent = Number.isFinite(net?.count) ? net.count : "0";
}

async function rescan() {
  if (activeTab) await tabMessage(activeTab.id, { type:"rescan" });
}
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
  if (!host || stateBusy) return;
  stateBusy = true;
  await send({ type:"setSiteAllowed", host, allowed:!siteAllowed });
  await rescan();
  stateBusy = false;
  refresh();
});
document.getElementById("pickerBtn").addEventListener("click", async () => {
  if (activeTab) await tabMessage(activeTab.id, { type:"startPicker" });
  window.close();
});
document.getElementById("falseBtn").addEventListener("click", async () => {
  if (activeTab) await tabMessage(activeTab.id, { type:"markFalsePositive" });
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
refresh();
