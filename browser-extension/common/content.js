(() => {
  if (window.__xadKillerInjected) return;
  window.__xadKillerInjected = true;

  const AD_SELECTORS = [
    ".adsbygoogle",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[id^='google_ads_']",
    "[id*='google_ads_iframe']",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']",
    "[aria-label='Advertisement']",
    "[aria-label='advertisement']",
    "[aria-label='Sponsored']",
    "[aria-label='sponsored']",
    "[data-testid*='ad-container']",
    "[class~='ad-container']",
    "[class~='ad-wrapper']",
    "[class~='ad-slot']",
    "[id^='ad-container']",
    "[id^='ad-slot']"
  ];

  const SKIP_TEXTS = [
    "skip ad", "skip ads", "skip advertisement", "close ad",
    "pomiń reklamę", "pomin reklame", "zamknij reklamę", "zamknij reklame",
    "omitir anuncio", "saltar anuncio", "cerrar anuncio",
    "werbung überspringen", "anzeige überspringen", "werbung schließen",
    "ignorer la publicité", "passer l'annonce", "fermer la publicité"
  ];

  let enabled = true;
  let autoSkip = true;
  let allowSites = [];
  let hiddenCount = 0;
  let skippedCount = 0;
  let observer = null;
  let scanTimer = null;
  let lastSkipAt = 0;

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

  function active() {
    return enabled && !siteAllowed();
  }

  function hideElement(el) {
    if (!(el instanceof Element) || el.dataset.xadkillerHidden === "1") return;
    el.dataset.xadkillerPrevDisplay = el.style.display || "";
    el.dataset.xadkillerHidden = "1";
    el.style.setProperty("display", "none", "important");
    hiddenCount++;
  }

  function restore() {
    document.querySelectorAll("[data-xadkiller-hidden='1']").forEach((el) => {
      const previous = el.dataset.xadkillerPrevDisplay || "";
      if (previous) el.style.display = previous;
      else el.style.removeProperty("display");
      delete el.dataset.xadkillerHidden;
      delete el.dataset.xadkillerPrevDisplay;
    });
  }

  function exactSkipText(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!text || text.length > 40) return false;
    return SKIP_TEXTS.some((needle) => text === needle || text.startsWith(needle + " "));
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  }

  function tryAutoSkip(root) {
    if (!autoSkip || Date.now() - lastSkipAt < 2500) return;
    const scope = root && root.querySelectorAll ? root : document;
    const candidates = scope.querySelectorAll("button, [role='button'], a");
    for (const el of candidates) {
      if (!visible(el)) continue;
      const label = el.getAttribute("aria-label") || el.textContent || "";
      if (!exactSkipText(label)) continue;
      lastSkipAt = Date.now();
      skippedCount++;
      el.click();
      break;
    }
  }

  function scan(root = document) {
    if (!active()) return;
    const scope = root && root.querySelectorAll ? root : document;
    for (const selector of AD_SELECTORS) {
      try {
        if (scope.matches && scope.matches(selector)) hideElement(scope);
        scope.querySelectorAll(selector).forEach(hideElement);
      } catch (_) {}
    }
    tryAutoSkip(scope);
  }

  function scheduleScan(root) {
    if (!active()) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(root || document), 60);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scheduleScan(node);
        }
      }
    });
    const begin = () => {
      if (!document.documentElement) return setTimeout(begin, 20);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scan(document);
    };
    begin();
  }

  function refreshPrefs() {
    chrome.storage.local.get({ enabled: true, autoSkip: true, allowSites: [] }, (prefs) => {
      enabled = prefs.enabled !== false;
      autoSkip = prefs.autoSkip !== false;
      allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      if (active()) scan(document);
      else restore();
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "getPageStats") {
      sendResponse({ ok: true, hidden: hiddenCount, skipped: skippedCount, active: active() });
      return false;
    }
    if (msg && msg.type === "rescan") {
      refreshPrefs();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.autoSkip) autoSkip = changes.autoSkip.newValue !== false;
    if (changes.allowSites) allowSites = Array.isArray(changes.allowSites.newValue) ? changes.allowSites.newValue : [];
    if (active()) scan(document);
    else restore();
  });

  refreshPrefs();
  startObserver();
})();
