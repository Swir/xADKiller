(() => {
  const STORAGE_KEY = "xadHeuristicRecoverySitesV1";
  const HISTORY_KEY = "xadBreakageRollbackHistoryV1";
  const ALARM = "xadkiller-heuristic-recovery-expiry";
  const MAX_SITES = 100;
  const MAX_MINUTES = 24 * 60;
  const MAX_HISTORY = 40;

  function normalizeHost(value) {
    let host = String(value || "").trim().toLowerCase();
    try { if (host.includes("://")) host = new URL(host).hostname; } catch (_) {}
    host = host.replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.includes("..") || !host.includes(".")) return "";
    return host;
  }
  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, (value) => resolve(value || defaults)));
  }
  function setLocal(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  function cleanMap(raw, now = Date.now()) {
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
  function match(hostValue, map, now = Date.now()) {
    const host = normalizeHost(hostValue);
    if (!host) return { active:false, until:0, host:"" };
    let best = 0;
    for (const [entry, untilRaw] of Object.entries(map || {})) {
      const domain = normalizeHost(entry);
      const until = Number(untilRaw || 0);
      if (!domain || until <= now) continue;
      if (host === domain || host.endsWith("." + domain)) best = Math.max(best, until);
    }
    return { active:best > now, until:best, host };
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
    const now = Date.now();
    const times = Object.values(map || {}).map(Number).filter((value) => Number.isFinite(value) && value > now);
    if (!times.length) return;
    try { chrome.alarms.create(ALARM, { when:Math.min(...times) + 250 }); } catch (_) {}
  }
  async function appendHistory(host, action, minutes, until) {
    try {
      const stored = await getLocal({ [HISTORY_KEY]:[] });
      const previous = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
      const entry = {
        host:normalizeHost(host),
        action:action === "start" ? "start" : "stop",
        at:Date.now(),
        minutes:Math.max(0, Math.min(MAX_MINUTES, Math.round(Number(minutes || 0)))),
        until:Math.max(0, Number(until || 0))
      };
      const next = [...previous.filter((item) => item && typeof item === "object"), entry].slice(-MAX_HISTORY);
      await setLocal({ [HISTORY_KEY]:next });
    } catch (_) {
      // Local diagnostics/history must never block recovery.
    }
  }
  async function setRecovery(hostValue, minutesValue) {
    const host = normalizeHost(hostValue);
    if (!host) return { ok:false, error:"invalid_host" };
    const map = await readMap(true);
    const minutes = Math.max(0, Math.min(MAX_MINUTES, Math.round(Number(minutesValue || 0))));
    let until = 0;
    if (minutes <= 0) {
      delete map[host];
    } else {
      until = Date.now() + minutes * 60 * 1000;
      map[host] = until;
    }
    const clean = cleanMap(map);
    await setLocal({ [STORAGE_KEY]:clean });
    await schedule(clean);
    await appendHistory(host, minutes > 0 ? "start" : "stop", minutes, until);
    const state = match(host, clean);
    return {
      ok:true,
      host,
      active:state.active,
      until:state.until,
      minutesLeft:state.active ? Math.max(1, Math.ceil((state.until - Date.now()) / 60000)) : 0,
      count:Object.keys(clean).length
    };
  }
  async function getRecovery(hostValue) {
    const map = await readMap(true);
    await schedule(map);
    const state = match(hostValue, map);
    return {
      ok:true,
      active:state.active,
      until:state.until,
      minutesLeft:state.active ? Math.max(1, Math.ceil((state.until - Date.now()) / 60000)) : 0,
      count:Object.keys(map).length
    };
  }
  async function history() {
    const stored = await getLocal({ [HISTORY_KEY]:[] });
    const items = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(-MAX_HISTORY) : [];
    return { ok:true, items };
  }

  chrome.runtime.onInstalled.addListener(() => readMap(true).then(schedule).catch(() => {}));
  chrome.runtime.onStartup.addListener(() => readMap(true).then(schedule).catch(() => {}));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== ALARM) return;
    readMap(true).then(schedule).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "setHeuristicSiteRecovery") {
      setRecovery(msg.host, msg.minutes).then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
      return true;
    }
    if (msg?.type === "getHeuristicSiteRecovery") {
      getRecovery(msg.host).then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
      return true;
    }
    if (msg?.type === "getBreakageRollbackHistory") {
      history().then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
      return true;
    }
    if (msg?.type === "clearBreakageRollbackHistory") {
      setLocal({ [HISTORY_KEY]:[] }).then(() => sendResponse({ ok:true })).catch((error) => sendResponse({ ok:false, error:String(error?.message || error) }));
      return true;
    }
    return false;
  });

  readMap(true).then(schedule).catch(() => {});
  globalThis.XAD_HEURISTIC_RECOVERY = Object.freeze({ normalizeHost, cleanMap, match });
})();