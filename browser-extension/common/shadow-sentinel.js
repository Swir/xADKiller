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
  let enabled = true;
  let smartEnabled = true;
  let allowSites = [];

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
  function active() { return enabled && smartEnabled && !allowed(); }

  function hideIn(root) {
    if (!active() || !root?.querySelectorAll) return;
    for (const selector of SELECTORS) {
      try {
        root.querySelectorAll(selector).forEach((el) => {
          if (!(el instanceof Element)) return;
          el.dataset.xadkillerShadowHidden = "1";
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("visibility", "hidden", "important");
        });
      } catch (_) {}
    }
  }

  function installStyle(root) {
    if (!(root instanceof ShadowRoot) || root.querySelector?.("style[data-xadkiller-shadow-style='1']")) return;
    try {
      const style = document.createElement("style");
      style.dataset.xadkillerShadowStyle = "1";
      style.textContent = STYLE_TEXT;
      root.appendChild(style);
    } catch (_) {}
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

  function refreshPrefs() {
    chrome.storage.local.get({ enabled:true, smartEnabled:true, allowSites:[] }, (prefs) => {
      enabled = prefs.enabled !== false;
      smartEnabled = prefs.smartEnabled !== false;
      allowSites = Array.isArray(prefs.allowSites) ? prefs.allowSites : [];
      if (active()) {
        hideIn(document);
        discover(document);
      }
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
