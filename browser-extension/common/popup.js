function t(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback || key;
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response || { ok: false });
    });
  });
}

function currentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0] ? tabs[0] : null));
  });
}

function tabMessage(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(null);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

document.querySelectorAll("[data-i18n]").forEach((el) => {
  const key = el.getAttribute("data-i18n");
  const value = t(key, el.textContent);
  if (value) el.textContent = value;
});

const enabledEl = document.getElementById("enabled");
const autoSkipEl = document.getElementById("autoSkip");
const statusText = document.getElementById("statusText");
const hostEl = document.getElementById("host");
const siteToggle = document.getElementById("siteToggle");
const hiddenCount = document.getElementById("hiddenCount");
const skipCount = document.getElementById("skipCount");

let activeTab = null;
let host = "";
let siteAllowed = false;
let stateBusy = false;

async function refresh() {
  activeTab = await currentTab();
  host = "";
  try {
    if (activeTab && /^https?:/i.test(activeTab.url || "")) host = new URL(activeTab.url).hostname;
  } catch (_) {}

  hostEl.textContent = host || t("unsupportedPage", "Browser page");
  const state = await send({ type: "getState", host });
  if (state && state.ok) {
    enabledEl.checked = !!state.enabled;
    autoSkipEl.checked = !!state.autoSkip;
    siteAllowed = !!state.siteAllowed;
    statusText.textContent = state.enabled ? t("statusOn", "ON") : t("statusOff", "OFF");
    siteToggle.disabled = !host;
    siteToggle.textContent = siteAllowed
      ? t("protectSite", "Protect this site")
      : t("allowSite", "Allow this site");
  }

  const stats = activeTab ? await tabMessage(activeTab.id, { type: "getPageStats" }) : null;
  hiddenCount.textContent = stats && Number.isFinite(stats.hidden) ? stats.hidden : "0";
  skipCount.textContent = stats && Number.isFinite(stats.skipped) ? stats.skipped : "0";
}

enabledEl.addEventListener("change", async () => {
  if (stateBusy) return;
  stateBusy = true;
  await send({ type: "setEnabled", enabled: enabledEl.checked });
  if (activeTab) await tabMessage(activeTab.id, { type: "rescan" });
  stateBusy = false;
  refresh();
});

autoSkipEl.addEventListener("change", async () => {
  await send({ type: "setAutoSkip", autoSkip: autoSkipEl.checked });
  if (activeTab) await tabMessage(activeTab.id, { type: "rescan" });
});

siteToggle.addEventListener("click", async () => {
  if (!host || stateBusy) return;
  stateBusy = true;
  await send({ type: "setSiteAllowed", host, allowed: !siteAllowed });
  if (activeTab) await tabMessage(activeTab.id, { type: "rescan" });
  stateBusy = false;
  refresh();
});

document.getElementById("testBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://superadblocktest.com/" });
});

document.getElementById("githubBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/Swir/xADKiller" });
});

refresh();
