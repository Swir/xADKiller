(() => {
  if (globalThis.__xadShadowSentinelV1) return;
  globalThis.__xadShadowSentinelV1 = true;

  const SELECTORS = [
    ".adsbygoogle",
    ".adbox.banner_ads.adsbox",
    ".textads",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[data-ad-unit]",
    "[data-sponsored='true']",
    "[aria-label='Advertisement']",
    "[aria-label='Sponsored']",
    "[id^='google_ads_']",
    "[id^='ad-container']",
    "[id^='ad-slot']",
    "[class~='ad-container']",
    "[class~='ad-wrapper']",
    "[class~='ad-slot']",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']"
  ];
  const STYLE_TEXT = `${SELECTORS.join(",")}{display:none!important;visibility:hidden!important;max-height:0!important;min-height:0!important}`;
  const watched = new WeakSet();
  const hidden = new Map();
  const styles = new Set();
  let enabled = false;
  let smartEnabled = true;
  let allowSites = [];
  let prefsReady = false;

  function normalizeHost(v) {
    return String(v || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }
  function allowed() {
    const host = normalizeHost(location.hostname);
    return allowSites.some((entry) => {
      const d = normalizeHost(entry);
      return d && (host === d || host.endsWith("." + d));
    });
  }
  function active() { return prefsReady && enabled && smartEnabled && !allowed(); }

  function rememberAndHide(el) {
    if (!(el instanceof Element)) return;
    if (!hidden.has(el)) {
      hidden.set(el, {
        display:el.style.getPropertyValue("display"),
        displayPriority:el.style.getPropertyPriority("display"),
        visibility:el.style.getPropertyValue("visibility"),
        visibilityPriority:el.style.getPropertyPriority("visibility")
      });
    }
    el.dataset.xadkillerShadowHidden = "1";
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
  }

  function restoreHidden() {
    for (const [el, previous] of [...hidden.entries()]) {
      try {
        if (previous.display) el.style.setProperty("display", previous.display, previous.displayPriority || "");
        else el.style.removeProperty("display");
        if (previous.visibility) el.style.setProperty("visibility", previous.visibility, previous.visibilityPriority || "");
        else el.style.removeProperty("visibility");
        delete el.dataset.xadkillerShadowHidden;
      } catch (_) {}
      hidden.delete(el);
    }
  }

  function updateStyles() {
    const css = active() ? STYLE_TEXT : "";
    for (const style of [...styles]) {
      if (!style?.isConnected) { styles.delete(style); continue; }
      try { if (style.textContent !== css) style.textContent = css; } catch (_) {}
    }
  }

  function hideIn(root) {
    if (!active() || !root?.querySelectorAll) return;
    for (const selector of SELECTORS) {
      try { root.querySelectorAll(selector).forEach(rememberAndHide); } catch (_) {}
    }
  }

  function installStyle(root) {
    if (!(root instanceof ShadowRoot)) return null;
    let existing = null;
    try { existing = root.querySelector?.("style[data-xadkiller-shadow-style='1']") || null; } catch (_) {}
    if (existing) {
      styles.add(existing);
      try { existing.textContent = active() ? STYLE_TEXT : ""; } catch (_) {}
      return existing;
    }
    try {
      const style = document.createElement("style");
      style.dataset.xadkillerShadowStyle = "1";
      style.textContent = active() ? STYLE_TEXT : "";
      root.appendChild(style);
      styles.add(style);
      return style;
    } catch (_) { return null; }
  }

  function watchRoot(root) {
    if (!(root instanceof ShadowRoot) || watched.has(root)) return;
    watched.add(root);
    installStyle(root);
    hideIn(root);
    const observer = new MutationObserver((mutations) => {
      if (!active()) return;
      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes?.length) { needsScan = true; break; }
      }
      if (needsScan) queueMicrotask(() => {
        installStyle(root);
        hideIn(root);
        discover(root);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function discover(root = document) {
    if (!active() || !root?.querySelectorAll) return;
    const nodes = root.querySelectorAll("*");
    let scanned = 0;
    for (const el of nodes) {
      if (el.shadowRoot) watchRoot(el.shadowRoot);
      if (++scanned >= 1800) break;
    }
  }

  function reconcile() {
    if (active()) {
      updateStyles();
      hideIn(document);
      discover(document);
    } else {
      restoreHidden();
      updateStyles();
    }
  }

  function refreshPrefs() {
    chrome.storage.local.get({ enabled:true, smartEnabled:true, allowSites:[] }, (prefs) => {
      enabled = prefs.enabled !== false;
      smartEnabled = prefs.smartEnabled !== false;
      allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      prefsReady = true;
      reconcile();
    });
  }

  const docObserver = new MutationObserver((mutations) => {
    if (!active()) return;
    let changed = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes?.length) { changed = true; break; }
    }
    if (changed) queueMicrotask(() => {
      hideIn(document);
      discover(document);
    });
  });

  const begin = () => {
    if (!document.documentElement) return setTimeout(begin, 15);
    docObserver.observe(document.documentElement, { childList:true, subtree:true });
    refreshPrefs();
  };
  begin();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled || changes.smartEnabled || changes.allowSites) refreshPrefs();
  });
})();
