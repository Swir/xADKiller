(() => {
  const TITAN_FEED_URL = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";
  const TITAN_ALARM = "xadkiller-titan-refresh";
  const REFRESH_MINUTES = 360;

  const REGEX_MIN = 160000;
  const REGEX_MAX = 160199;
  const SESSION_MIN = 200000;
  const SESSION_MAX = 204499;
  const LEARN_MIN = 290000;
  const LEARN_MAX = 290299;
  const STANDARD_SESSION_LIMIT = 2800;
  const ULTRA_SESSION_LIMIT = 4500;

  const RESOURCE_TYPES = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","font","ping","websocket","other"];
  const STRONG_HOST = /(doubleclick|googlesyndication|googleadservices|amazon-adsystem|adnxs|adsrvr|pubmatic|rubicon|criteo|taboola|outbrain|smartadserver|adform|prebid|hotjar|mouseflow|luckyorange|fullstory|logrocket|appsflyer|adjust|branch|kochava|unityads|samsungads|xiaomi|huawei|oppomobile)/i;
  const STRONG_PATH = /\/(?:ads?|adserver|adservice|adrequest|pagead|gampad|securepubads|prebid|vast|vmap|ima3|commercial|sponsor|sponsored|promoted)(?:[._\/-]|$)/i;
  const STRONG_QUERY = /(?:^|[?&])(?:ad_unit|adunit|ad_slot|adslot|gdfp_req|iu|campaign|impression)=/i;

  let packagedSessionPromise = null;
  let titanFeedPromise = null;

  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function setLocal(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  function getSessionRules() {
    return new Promise((resolve) => chrome.declarativeNetRequest.getSessionRules((rules) => resolve(rules || [])));
  }
  function updateSessionRules(payload) {
    return new Promise((resolve, reject) => chrome.declarativeNetRequest.updateSessionRules(payload, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) reject(new Error(error)); else resolve();
    }));
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
  function normalizeHost(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }
  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function sameSite(a, b) {
    a = normalizeHost(a); b = normalizeHost(b);
    return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
  }

  async function loadPackagedSessionRules() {
    if (!packagedSessionPromise) {
      packagedSessionPromise = fetch(chrome.runtime.getURL("rules/titan-session.json"))
        .then((r) => { if (!r.ok) throw new Error(`titan_session_http_${r.status}`); return r.json(); })
        .then((rules) => (Array.isArray(rules) ? rules : []).filter((r) => r && Number.isInteger(r.id) && r.id >= SESSION_MIN && r.id <= SESSION_MAX).slice(0, ULTRA_SESSION_LIMIT))
        .catch((error) => { console.warn("xADKiller TITAN packaged session rules unavailable", error); return []; });
    }
    return packagedSessionPromise;
  }

  async function applySessionShield() {
    const [prefs, packaged, current] = await Promise.all([
      getLocal({ enabled:true, mode:"standard" }),
      loadPackagedSessionRules(),
      getSessionRules()
    ]);
    const removeRuleIds = current.filter((r) => r.id >= SESSION_MIN && r.id <= SESSION_MAX).map((r) => r.id);
    if (prefs.enabled === false) {
      const learnedIds = current.filter((r) => r.id >= LEARN_MIN && r.id <= LEARN_MAX).map((r) => r.id);
      await updateSessionRules({ removeRuleIds:[...removeRuleIds, ...learnedIds], addRules:[] });
      return { count:0 };
    }
    const limit = prefs.mode === "ultra" ? ULTRA_SESSION_LIMIT : STANDARD_SESSION_LIMIT;
    const addRules = packaged.slice(0, limit);
    await updateSessionRules({ removeRuleIds, addRules });
    return { count:addRules.length };
  }

  function cleanRegexEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const regex = String(raw.regex || "").trim();
    if (!regex || regex.length > 900 || /[\r\n]/.test(regex)) return null;
    const types = [...new Set((Array.isArray(raw.types) ? raw.types : []).filter((t) => RESOURCE_TYPES.includes(t)))].slice(0, 10);
    if (!types.length) return null;
    return { regex, types, thirdParty:raw.third_party === true };
  }

  async function fetchTitanFeed(force = false) {
    if (!force && titanFeedPromise) return titanFeedPromise;
    titanFeedPromise = (async () => {
      const cached = await getLocal({ xadTitanFeed:null, xadTitanFetchedAt:0 });
      if (!force && cached.xadTitanFeed && Date.now() - Number(cached.xadTitanFetchedAt || 0) < REFRESH_MINUTES * 60 * 1000) return cached.xadTitanFeed;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetch(`${TITAN_FEED_URL}?v=${Date.now()}`, { cache:"no-store", signal:controller.signal, headers:{ accept:"application/json" } });
        if (!response.ok) throw new Error(`titan_feed_http_${response.status}`);
        const data = await response.json();
        if (data?.schema !== 1) throw new Error("titan_feed_schema");
        const feed = {
          version:String(data.feed_version || "unknown").slice(0, 80),
          regex:(Array.isArray(data.regex_signatures) ? data.regex_signatures : []).map(cleanRegexEntry).filter(Boolean).slice(0, 150),
          fetchedAt:Date.now()
        };
        await setLocal({ xadTitanFeed:feed, xadTitanFetchedAt:feed.fetchedAt });
        return feed;
      } catch (error) {
        console.warn("xADKiller TITAN feed update failed; using cache", error);
        return cached.xadTitanFeed || { version:"", regex:[], fetchedAt:0 };
      } finally {
        clearTimeout(timer);
      }
    })();
    return titanFeedPromise;
  }

  async function regexSupported(regex) {
    try {
      const result = await chrome.declarativeNetRequest.isRegexSupported({ regex });
      return !!result?.isSupported;
    } catch (_) {
      return false;
    }
  }

  async function applyRegexShield(force = false) {
    const [prefs, feed, current] = await Promise.all([
      getLocal({ enabled:true, mode:"standard" }),
      fetchTitanFeed(force),
      getDynamicRules()
    ]);
    const removeRuleIds = current.filter((r) => r.id >= REGEX_MIN && r.id <= REGEX_MAX).map((r) => r.id);
    if (prefs.enabled === false) {
      await updateDynamicRules({ removeRuleIds, addRules:[] });
      return { count:0, version:feed.version };
    }
    const candidates = prefs.mode === "ultra" ? feed.regex : feed.regex.slice(0, Math.max(1, Math.ceil(feed.regex.length * 0.65)));
    const addRules = [];
    for (const item of candidates) {
      if (addRules.length >= REGEX_MAX - REGEX_MIN + 1) break;
      if (!(await regexSupported(item.regex))) continue;
      addRules.push({
        id:REGEX_MIN + addRules.length,
        priority:item.thirdParty ? 82 : 90,
        action:{ type:"block" },
        condition:{ regexFilter:item.regex, resourceTypes:item.types, ...(item.thirdParty ? { domainType:"thirdParty" } : {}) }
      });
    }
    await updateDynamicRules({ removeRuleIds, addRules });
    return { count:addRules.length, version:feed.version };
  }

  function learningRuleFrom(urlValue, pageHost) {
    let u;
    try { u = new URL(String(urlValue || "")); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = normalizeHost(u.hostname);
    const own = sameSite(host, pageHost);
    const pathQuery = `${u.pathname}${u.search}`;
    if (!own && STRONG_HOST.test(host)) {
      return { priority:95, action:{type:"block"}, condition:{ requestDomains:[host], resourceTypes:RESOURCE_TYPES } };
    }
    const pathMatch = pathQuery.match(STRONG_PATH);
    if (own && pathMatch) {
      return { priority:92, action:{type:"block"}, condition:{ urlFilter:pathMatch[0], domainType:"firstParty", resourceTypes:["script","xmlhttprequest","sub_frame","image","media"] } };
    }
    const queryMatch = pathQuery.match(STRONG_QUERY);
    if (queryMatch) {
      return { priority:90, action:{type:"block"}, condition:{ urlFilter:queryMatch[0], resourceTypes:["script","xmlhttprequest","sub_frame","image","ping"] } };
    }
    return null;
  }

  async function learnResource(url, pageHost) {
    const prefs = await getLocal({ enabled:true, mode:"standard" });
    if (prefs.enabled === false || prefs.mode !== "ultra") return { ok:false, ignored:true };
    const rule = learningRuleFrom(url, pageHost);
    if (!rule) return { ok:false, ignored:true };
    const current = await getSessionRules();
    const key = JSON.stringify(rule.condition);
    const learned = current.filter((r) => r.id >= LEARN_MIN && r.id <= LEARN_MAX);
    if (learned.some((r) => JSON.stringify(r.condition) === key)) return { ok:true, duplicate:true };
    const id = LEARN_MIN + (fnv1a(key) % (LEARN_MAX - LEARN_MIN + 1));
    const removeRuleIds = current.some((r) => r.id === id) ? [id] : [];
    await updateSessionRules({ removeRuleIds, addRules:[{ id, ...rule }] });
    return { ok:true, learned:true };
  }

  async function refresh(force = false) {
    const [session, regex] = await Promise.all([applySessionShield(), applyRegexShield(force)]);
    return { ok:true, session:session.count, regex:regex.count, version:regex.version };
  }

  async function stats() {
    const [session, dynamic, feed] = await Promise.all([getSessionRules(), getDynamicRules(), fetchTitanFeed(false)]);
    return {
      ok:true,
      version:feed.version,
      session:session.filter((r) => r.id >= SESSION_MIN && r.id <= SESSION_MAX).length,
      learned:session.filter((r) => r.id >= LEARN_MIN && r.id <= LEARN_MAX).length,
      regex:dynamic.filter((r) => r.id >= REGEX_MIN && r.id <= REGEX_MAX).length
    };
  }

  function schedule() {
    try { chrome.alarms.create(TITAN_ALARM, { delayInMinutes:1, periodInMinutes:REFRESH_MINUTES }); } catch (_) {}
  }

  chrome.runtime.onInstalled.addListener(() => { schedule(); refresh(true).catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { schedule(); refresh(false).catch(() => {}); });
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm?.name === TITAN_ALARM) refresh(true).catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode)) refresh(false).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "titanLearnResource") {
      learnResource(msg.url, msg.pageHost).then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    if (msg?.type === "refreshTitan") {
      titanFeedPromise = null;
      refresh(true).then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    if (msg?.type === "getTitanStats") {
      stats().then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    return false;
  });

  schedule();
  refresh(false).catch(() => {});
})();
