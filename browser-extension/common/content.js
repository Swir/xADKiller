(() => {
  if (window.__xadKillerInjected) return;
  window.__xadKillerInjected = true;

  const DATA = globalThis.XAD_COSMETIC_DATA || { generic: [], scoped: [], meta: {} };
  const RECOVERY_KEY = "xadHeuristicRecoverySitesV1";
  const BASE_SELECTORS = [
    ".adsbygoogle","[data-ad-client]","[data-ad-slot]","[data-ad-unit]","[data-adunit]",
    "[id^='google_ads_']","[id*='google_ads_iframe']","iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']","[aria-label='Advertisement']","[aria-label='Sponsored']",
    "[data-testid*='ad-container']","[class~='ad-container']","[class~='ad-wrapper']","[class~='ad-slot']",
    "[id^='ad-container']","[id^='ad-slot']","[data-sponsored='true']"
  ];
  const SKIP_TEXTS = [
    "skip ad","skip ads","skip advertisement","close ad","continue to content",
    "pomiń reklamę","pomin reklame","zamknij reklamę","zamknij reklame","przejdź do treści",
    "omitir anuncio","saltar anuncio","cerrar anuncio",
    "werbung überspringen","anzeige überspringen","werbung schließen",
    "ignorer la publicité","passer l'annonce","fermer la publicité"
  ];
  const TEXT_AD = /^(advertisement|advert|sponsored|promoted|ad|reklama|sponsorowane|publicidad|anuncio|werbung|anzeige|publicité|sponsorisé)$/i;
  const STRONG_TOKEN = /(^|[-_])(ad|ads|advert|advertisement|adslot|adunit|adcontainer|sponsor|sponsored|promoted|commercial|banner)([-_]|$)/i;
  const TRACK_TOKEN = /(doubleclick|googlesyndication|adservice|adserver|prebid|taboola|outbrain|criteo|adnxs|adsrvr|pubmatic|rubicon)/i;

  let enabled = true;
  let mode = "standard";
  let autoSkip = true;
  let smartEnabled = true;
  let allowSites = [];
  let heuristicRecoverySites = {};
  let customCosmetic = {};
  let learnWeights = {};
  let hiddenCount = 0;
  let smartHidden = 0;
  let skippedCount = 0;
  let observer = null;
  let scanTimer = null;
  let lastSkipAt = 0;
  let lastSmart = null;
  let pickerActive = false;
  let pickerTarget = null;
  let styleEl = null;

  function normalizeHost(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }
  function siteAllowed() {
    const host = normalizeHost(location.hostname);
    return allowSites.some((entry) => {
      const d = normalizeHost(entry);
      return d && (host === d || host.endsWith("." + d));
    });
  }
  function heuristicRecoveryActive(now = Date.now()) {
    const host = normalizeHost(location.hostname);
    if (!host || !heuristicRecoverySites || typeof heuristicRecoverySites !== "object") return false;
    return Object.entries(heuristicRecoverySites).some(([entry, rawUntil]) => {
      const d = normalizeHost(entry);
      const until = Number(rawUntil || 0);
      return d && Number.isFinite(until) && until > now && (host === d || host.endsWith("." + d));
    });
  }
  function active() { return enabled && !siteAllowed() && !heuristicRecoveryActive(); }
  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function tokensFor(el) {
    if (!(el instanceof Element)) return [];
    const values = [el.id, el.className, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("data-testid"), el.getAttribute("data-ad-slot"), el.getAttribute("data-ad-unit")]
      .filter((v) => typeof v === "string" && v.length < 240).join(" ").toLowerCase();
    return [...new Set(values.split(/[^a-z0-9_-]+/).filter((x) => x.length >= 2 && x.length <= 40))].slice(0, 24);
  }
  function learnedScore(tokens) {
    let score = 0;
    for (const token of tokens) score += Number(learnWeights[fnv1a(token)] || 0);
    return Math.max(-8, Math.min(12, score));
  }
  function visible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }
  function unsafeContainer(el) {
    if (!(el instanceof Element)) return true;
    const tag = el.tagName.toLowerCase();
    if (["html","body","main","header","footer","nav"].includes(tag)) return true;
    const r = el.getBoundingClientRect();
    const area = Math.max(1, innerWidth * innerHeight);
    return r.width * r.height > area * 0.88;
  }
  function hideElement(el, kind = "basic") {
    if (!(el instanceof Element) || el.dataset.xadkillerHidden === "1" || unsafeContainer(el)) return false;
    el.dataset.xadkillerPrevDisplay = el.style.display || "";
    el.dataset.xadkillerHidden = "1";
    el.style.setProperty("display", "none", "important");
    hiddenCount++;
    if (kind === "smart") smartHidden++;
    return true;
  }
  function restoreElement(el) {
    if (!(el instanceof Element) || el.dataset.xadkillerHidden !== "1") return;
    const previous = el.dataset.xadkillerPrevDisplay || "";
    if (previous) el.style.display = previous; else el.style.removeProperty("display");
    delete el.dataset.xadkillerHidden;
    delete el.dataset.xadkillerPrevDisplay;
  }
  function restoreAll() {
    document.querySelectorAll("[data-xadkiller-hidden='1']").forEach(restoreElement);
    if (styleEl) styleEl.disabled = true;
  }
  function cssRule(selector) {
    try { document.querySelector(selector); return `${selector}{display:none!important;visibility:hidden!important}`; } catch (_) { return ""; }
  }
  function selectorsForHost() {
    const host = normalizeHost(location.hostname);
    const selectors = [...BASE_SELECTORS, ...(Array.isArray(DATA.generic) ? DATA.generic : [])];
    for (const pair of Array.isArray(DATA.scoped) ? DATA.scoped : []) {
      const domain = normalizeHost(pair?.[0]);
      if (domain && (host === domain || host.endsWith("." + domain)) && Array.isArray(pair[1])) selectors.push(...pair[1]);
    }
    const custom = customCosmetic && Array.isArray(customCosmetic[host]) ? customCosmetic[host] : [];
    selectors.push(...custom);
    return [...new Set(selectors)].slice(0, mode === "ultra" ? 8000 : 5500);
  }
  function rebuildCosmeticCss() {
    if (!document.documentElement) return;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "xadkiller-cosmetic";
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (!active()) { styleEl.disabled = true; return; }
    const rules = [];
    for (const selector of selectorsForHost()) {
      const r = cssRule(selector);
      if (r) rules.push(r);
    }
    styleEl.textContent = rules.join("\n");
    styleEl.disabled = false;
  }
  function exactSkipText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text || text.length > 55) return false;
    return SKIP_TEXTS.some((needle) => text === needle || text.startsWith(needle + " "));
  }
  function tryAutoSkip(root) {
    if (!autoSkip || Date.now() - lastSkipAt < 2200) return;
    const scope = root && root.querySelectorAll ? root : document;
    for (const el of scope.querySelectorAll("button,[role='button'],a")) {
      if (!visible(el)) continue;
      const label = el.getAttribute("aria-label") || el.textContent || "";
      if (!exactSkipText(label)) continue;
      lastSkipAt = Date.now();
      skippedCount++;
      el.click();
      break;
    }
  }
  function smartScore(el) {
    if (!(el instanceof Element) || unsafeContainer(el)) return -99;
    const tokens = tokensFor(el);
    const blob = tokens.join(" ");
    let score = learnedScore(tokens);
    if (STRONG_TOKEN.test(blob)) score += 5;
    if (TRACK_TOKEN.test(blob)) score += 6;
    if (el.hasAttribute("data-ad-slot") || el.hasAttribute("data-ad-client") || el.hasAttribute("data-sponsored")) score += 7;
    const aria = (el.getAttribute("aria-label") || "").trim();
    if (TEXT_AD.test(aria)) score += 6;
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt.length <= 32 && TEXT_AD.test(txt)) score += 5;
    if (el.tagName === "IFRAME" && TRACK_TOKEN.test(el.getAttribute("src") || "")) score += 9;
    const r = el.getBoundingClientRect();
    if (r.width > 80 && r.height > 35 && r.height < innerHeight * 0.7) score += 1;
    return score;
  }
  function smartScan(root) {
    if (!smartEnabled || !active()) return;
    const scope = root instanceof Element ? root : document.documentElement;
    const candidates = [];
    if (scope instanceof Element) candidates.push(scope);
    if (scope?.querySelectorAll) {
      for (const el of scope.querySelectorAll("iframe,[id],[class],[data-testid],[data-ad-slot],[aria-label]")) {
        candidates.push(el);
        if (candidates.length >= 600) break;
      }
    }
    const threshold = mode === "ultra" ? 6 : 8;
    for (const el of candidates) {
      if (!visible(el) || el.dataset.xadkillerHidden === "1") continue;
      const score = smartScore(el);
      if (score < threshold) continue;
      const tokens = tokensFor(el);
      if (hideElement(el, "smart")) lastSmart = { el, tokens, score };
    }
  }
  function scan(root = document) {
    if (!active()) return;
    const scope = root && root.querySelectorAll ? root : document;
    for (const selector of BASE_SELECTORS) {
      try {
        if (scope.matches && scope.matches(selector)) hideElement(scope);
        scope.querySelectorAll(selector).forEach((el) => hideElement(el));
      } catch (_) {}
    }
    smartScan(root);
    tryAutoSkip(scope);
  }
  function scheduleScan() {
    if (!active()) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(document), 45);
  }
  function updateWeights(tokens, delta) {
    const next = { ...(learnWeights || {}) };
    for (const token of tokens || []) {
      const key = fnv1a(token);
      next[key] = Math.max(-6, Math.min(8, Number(next[key] || 0) + delta));
      if (next[key] === 0) delete next[key];
    }
    const entries = Object.entries(next).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 600);
    learnWeights = Object.fromEntries(entries);
    chrome.storage.local.set({ learnWeights });
  }
  function robustSelector(el) {
    if (!(el instanceof Element)) return "";
    if (el.id && el.id.length < 64 && /^[A-Za-z][\w:-]*$/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const testid = el.getAttribute("data-testid");
    if (testid && testid.length < 80) return `[data-testid="${CSS.escape(testid)}"]`;
    const classes = [...el.classList].filter((c) => c.length > 1 && c.length < 50 && !/^(active|selected|open|visible)$/i.test(c)).slice(0, 3);
    if (classes.length) return `${el.tagName.toLowerCase()}${classes.map((c) => "." + CSS.escape(c)).join("")}`;
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && depth < 4; depth++, cur = cur.parentElement) {
      let part = cur.tagName.toLowerCase();
      const siblings = cur.parentElement ? [...cur.parentElement.children].filter((x) => x.tagName === cur.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      parts.unshift(part);
    }
    return parts.join(" > ");
  }
  function savePicked(el) {
    const host = normalizeHost(location.hostname);
    const selector = robustSelector(el);
    if (!host || !selector) return;
    const next = { ...(customCosmetic || {}) };
    const set = new Set(Array.isArray(next[host]) ? next[host] : []);
    set.add(selector);
    next[host] = [...set].slice(-100);
    customCosmetic = next;
    chrome.storage.local.set({ customCosmetic: next });
    updateWeights(tokensFor(el), 2.5);
    hideElement(el, "smart");
    rebuildCosmeticCss();
  }
  function stopPicker() {
    pickerActive = false;
    if (pickerTarget) pickerTarget.style.removeProperty("outline");
    pickerTarget = null;
    document.removeEventListener("mousemove", pickerMove, true);
    document.removeEventListener("click", pickerClick, true);
    document.removeEventListener("keydown", pickerKey, true);
  }
  function pickerMove(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (pickerTarget && pickerTarget !== el) pickerTarget.style.removeProperty("outline");
    pickerTarget = el;
    if (pickerTarget) pickerTarget.style.setProperty("outline", "3px solid #00d8ff", "important");
  }
  function pickerClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = e.target instanceof Element ? e.target : pickerTarget;
    if (el) { el.style.removeProperty("outline"); savePicked(el); }
    stopPicker();
  }
  function pickerKey(e) { if (e.key === "Escape") stopPicker(); }
  function startPicker() {
    if (!active()) return false;
    stopPicker();
    pickerActive = true;
    document.addEventListener("mousemove", pickerMove, true);
    document.addEventListener("click", pickerClick, true);
    document.addEventListener("keydown", pickerKey, true);
    return true;
  }
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      let hasAddedElement = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) { hasAddedElement = true; break; }
        }
        if (hasAddedElement) break;
      }
      if (hasAddedElement) scheduleScan();
    });
    const begin = () => {
      if (!document.documentElement) return setTimeout(begin, 20);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      rebuildCosmeticCss();
      scan(document);
    };
    begin();
  }
  function refreshPrefs() {
    chrome.storage.local.get({ enabled:true, mode:"standard", autoSkip:true, smartEnabled:true, allowSites:[], [RECOVERY_KEY]:{}, customCosmetic:{}, learnWeights:{} }, (prefs) => {
      enabled = prefs.enabled !== false;
      mode = prefs.mode === "ultra" ? "ultra" : "standard";
      autoSkip = prefs.autoSkip !== false;
      smartEnabled = prefs.smartEnabled !== false;
      allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      heuristicRecoverySites = prefs[RECOVERY_KEY] && typeof prefs[RECOVERY_KEY] === "object" ? prefs[RECOVERY_KEY] : {};
      customCosmetic = prefs.customCosmetic && typeof prefs.customCosmetic === "object" ? prefs.customCosmetic : {};
      learnWeights = prefs.learnWeights && typeof prefs.learnWeights === "object" ? prefs.learnWeights : {};
      rebuildCosmeticCss();
      if (active()) scan(document); else restoreAll();
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "getPageStats") {
      const host = normalizeHost(location.hostname);
      sendResponse({ ok:true, hidden:hiddenCount, smart:smartHidden, skipped:skippedCount, active:active(), recovery:heuristicRecoveryActive(), learned:Object.keys(learnWeights).length, custom:Array.isArray(customCosmetic?.[host]) ? customCosmetic[host].length : 0 });
      return false;
    }
    if (msg?.type === "rescan") { refreshPrefs(); sendResponse({ ok:true }); return false; }
    if (msg?.type === "startPicker") { sendResponse({ ok:startPicker() }); return false; }
    if (msg?.type === "markFalsePositive") {
      const hadFalsePositive = !!lastSmart?.el;
      if (lastSmart?.el) restoreElement(lastSmart.el);
      if (lastSmart?.tokens) updateWeights(lastSmart.tokens, -3);
      if (hadFalsePositive) {
        try { chrome.runtime.sendMessage({ type:"setHeuristicSiteRecovery", host:location.hostname, minutes:15 }); } catch (_) {}
      }
      sendResponse({ ok:hadFalsePositive, recoveryMinutes:hadFalsePositive ? 15 : 0 });
      lastSmart = null;
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.mode) mode = changes.mode.newValue === "ultra" ? "ultra" : "standard";
    if (changes.autoSkip) autoSkip = changes.autoSkip.newValue !== false;
    if (changes.smartEnabled) smartEnabled = changes.smartEnabled.newValue !== false;
    if (changes.allowSites) allowSites = Array.isArray(changes.allowSites.newValue) ? changes.allowSites.newValue : [];
    if (changes[RECOVERY_KEY]) heuristicRecoverySites = changes[RECOVERY_KEY].newValue && typeof changes[RECOVERY_KEY].newValue === "object" ? changes[RECOVERY_KEY].newValue : {};
    if (changes.customCosmetic) customCosmetic = changes.customCosmetic.newValue || {};
    if (changes.learnWeights) learnWeights = changes.learnWeights.newValue || {};
    rebuildCosmeticCss();
    if (active()) scan(document); else restoreAll();
  });

  refreshPrefs();
  startObserver();
})();