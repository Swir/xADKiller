(() => {
  const STORAGE_KEY = "xadTemporaryPauseSitesV1";
  const ALARM = "xadkiller-temporary-site-pause-expiry";
  const RULE_MIN = 905000;
  const RULE_MAX = 905199;
  const MAX_SITES = RULE_MAX - RULE_MIN + 1;
  const MAX_MINUTES = 24 * 60;

  function normalizeHost(value) {
    let host = String(value || "").trim().toLowerCase();
    try { if (host.includes("://")) host = new URL(host).hostname; } catch (_) {}
    host = host.replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
    if (!host || host.length > 253 || !/^[a-z0-9.:-]+$/.test(host) || host.includes("..")) return "";
    return host;
  }
  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function setLocal(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  function getDynamicRules() {
    return new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules || [])));
  }
  function updateDynamicRules(payload) {
    return new Promise((resolve, reject) => chrome.declarativeNetRequest.updateDynamicRules(payload, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) reject(new Error(error)); else resolve();
    }));
  }
  function cleanMap(raw) {
    const now = Date.now();
    const out = {};
    const entries = raw && typeof raw === "object" ? Object.entries(raw) : [];
    for (const [rawHost, rawUntil] of entries) {
      const host = normalizeHost(rawHost);
      const until = Number(rawUntil || 0);
      if (!host || !Number.isFinite(until) || until <= now) continue;
      out[host] = Math.min(until, now + MAX_MINUTES * 60 * 1000);
      if (Object.keys(out).length >= MAX_SITES) break;
    }
    return out;
  }
  async function readMap(writeBack = false) {
    const stored = await getLocal({ [STORAGE_KEY]:{} });
    const raw = stored[STORAGE_KEY] || {};
    const clean = cleanMap(raw);
    if (writeBack && JSON.stringify(raw) !== JSON.stringify(clean)) await setLocal({ [STORAGE_KEY]:clean });
    return clean;
  }
  async function schedule(map) {
    try { await chrome.alarms.clear(ALARM); } catch (_) {}
    const times = Object.values(map || {}).map(Number).filter((v) => Number.isFinite(v) && v > Date.now());
    if (!times.length) return;
    try { chrome.alarms.create(ALARM, { when:Math.min(...times) + 250 }); } catch (_) {}
  }
  async function apply() {
    const [map, current] = await Promise.all([readMap(true), getDynamicRules()]);
    const removeRuleIds = current.filter((r) => r.id >= RULE_MIN && r.id <= RULE_MAX).map((r) => r.id);
    const hosts = Object.entries(map).sort((a,b) => a[1] - b[1]).slice(0, MAX_SITES);
    const addRules = hosts.map(([host], index) => ({
      id:RULE_MIN + index,
      priority:110000,
      action:{ type:"allowAllRequests" },
      condition:{ requestDomains:[host], resourceTypes:["main_frame","sub_frame"] }
    }));
    await updateDynamicRules({ removeRuleIds, addRules });
    await schedule(map);
    return { map, rules:addRules.length };
  }
  function matchPause(hostValue, map) {
    const host = normalizeHost(hostValue);
    if (!host) return { paused:false, until:0 };
    let best = 0;
    for (const [entry, untilRaw] of Object.entries(map || {})) {
      const domain = normalizeHost(entry);
      const until = Number(untilRaw || 0);
      if (!domain || until <= Date.now()) continue;
      if (host === domain || host.endsWith("." + domain)) best = Math.max(best, until);
    }
    return { paused:best > Date.now(), until:best };
  }
  async function setPause(hostValue, minutesValue) {
    const host = normalizeHost(hostValue);
    if (!host) return { ok:false, error:"invalid_host" };
    const map = await readMap(true);
    const minutes = Math.max(0, Math.min(MAX_MINUTES, Math.round(Number(minutesValue || 0))));
    if (minutes <= 0) delete map[host];
    else map[host] = Date.now() + minutes * 60 * 1000;
    await setLocal({ [STORAGE_KEY]:cleanMap(map) });
    const state = await apply();
    const match = matchPause(host, state.map);
    return { ok:true, host, paused:match.paused, until:match.until, rules:state.rules };
  }
  async function getPause(hostValue) {
    const map = await readMap(true);
    const match = matchPause(hostValue, map);
    return {
      ok:true,
      paused:match.paused,
      until:match.until,
      minutesLeft:match.paused ? Math.max(1, Math.ceil((match.until - Date.now()) / 60000)) : 0,
      count:Object.keys(map).length
    };
  }

  chrome.runtime.onInstalled.addListener(() => apply().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => apply().catch(() => {}));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM) apply().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "setTemporarySitePause") {
      setPause(msg.host, msg.minutes).then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    if (msg?.type === "getTemporarySitePause") {
      getPause(msg.host).then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    return false;
  });

  apply().catch(() => {});
})();
