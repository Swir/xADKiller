(() => {
  if (globalThis.__xadTitanMainV1) return;
  globalThis.__xadTitanMainV1 = true;

  let active = true;
  let ultra = false;
  const shadowRoots = new WeakSet();
  const AD_SELECTOR = ".adsbygoogle,.adbox.banner_ads.adsbox,.textads,[data-ad-client],[data-ad-slot],[data-ad-unit],[data-sponsored='true'],[aria-label='Advertisement'],[aria-label='Sponsored'],[id^='google_ads_'],[id^='ad-container'],[id^='ad-slot'],[class~='ad-container'],[class~='ad-wrapper'],[class~='ad-slot']";
  const SHADOW_CSS = `${AD_SELECTOR}{display:none!important;visibility:hidden!important;max-height:0!important;min-height:0!important}`;
  const STRONG_URL = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|amazon-adsystem\.com|adnxs\.com|adsrvr\.org|pubmatic\.com|rubiconproject\.com|criteo\.(?:com|net)|taboola\.com|outbrain\.com|smartadserver\.com|adform\.net|\/ads?(?:[._\/-]|$)|\/adserver|\/adservice|\/adrequest|\/pagead|\/gampad|\/securepubads|\/prebid|\/vast|\/vmap|\/ima3|[?&](?:ad_unit|adunit|ad_slot|adslot|gdfp_req|iu)=)/i;
  const STRONG_MARKUP = /<(?:script|iframe|img|link)[^>]+(?:doubleclick|googlesyndication|googleadservices|amazon-adsystem|adnxs|adsrvr|pubmatic|rubicon|criteo|taboola|outbrain|pagead|gampad|securepubads|prebid|ads?\.js|adserver|adservice)/i;

  window.addEventListener("xadkiller:preflight-config", (event) => {
    if (typeof event?.detail?.active === "boolean") active = event.detail.active;
    ultra = event?.detail?.mode === "ultra";
  }, true);

  function asUrl(value) {
    try { return new URL(String(value || ""), location.href); } catch (_) { return null; }
  }
  function shouldBlock(value) {
    if (!active) return false;
    const u = asUrl(value);
    if (!u || !/^(?:https?|wss?):$/i.test(u.protocol)) return false;
    return STRONG_URL.test(`${u.hostname}${u.pathname}${u.search}`);
  }
  function hideShadow(root) {
    if (!active || !root?.querySelectorAll) return;
    try { root.querySelectorAll(AD_SELECTOR).forEach((el) => { try { el.style.setProperty("display","none","important"); el.style.setProperty("visibility","hidden","important"); } catch (_) {} }); } catch (_) {}
  }
  function guardShadow(root) {
    if (!root || shadowRoots.has(root)) return;
    shadowRoots.add(root);
    try {
      const style = document.createElement("style");
      style.dataset.xadkillerTitanShadow = "1";
      style.textContent = SHADOW_CSS;
      root.appendChild(style);
    } catch (_) {}
    hideShadow(root);
    try {
      const observer = new MutationObserver(() => queueMicrotask(() => hideShadow(root)));
      observer.observe(root, { childList:true, subtree:true });
    } catch (_) {}
  }

  const nativeAttachShadow = Element.prototype.attachShadow;
  if (typeof nativeAttachShadow === "function") {
    Element.prototype.attachShadow = function(init) {
      const root = Reflect.apply(nativeAttachShadow, this, arguments);
      guardShadow(root); // works for both open and closed roots at creation time
      return root;
    };
  }

  const nativeOpen = window.open;
  if (typeof nativeOpen === "function") {
    window.open = function(url) {
      if (ultra && shouldBlock(url)) return null;
      return Reflect.apply(nativeOpen, this, arguments);
    };
  }

  function wrapWorker(name) {
    const Native = globalThis[name];
    if (typeof Native !== "function") return;
    function XadWorker(url, options) {
      if (ultra && shouldBlock(url)) throw new DOMException("Blocked by xADKiller TITAN", "SecurityError");
      return new Native(url, options);
    }
    XadWorker.prototype = Native.prototype;
    Object.setPrototypeOf(XadWorker, Native);
    globalThis[name] = XadWorker;
  }
  wrapWorker("Worker");
  wrapWorker("SharedWorker");

  const nativeWrite = Document.prototype.write;
  if (typeof nativeWrite === "function") {
    Document.prototype.write = function(...args) {
      if (ultra && args.some((x) => STRONG_MARKUP.test(String(x || "")))) return;
      return Reflect.apply(nativeWrite, this, args);
    };
  }
  const nativeWriteln = Document.prototype.writeln;
  if (typeof nativeWriteln === "function") {
    Document.prototype.writeln = function(...args) {
      if (ultra && args.some((x) => STRONG_MARKUP.test(String(x || "")))) return;
      return Reflect.apply(nativeWriteln, this, args);
    };
  }
  const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  if (typeof nativeInsertAdjacentHTML === "function") {
    Element.prototype.insertAdjacentHTML = function(position, html) {
      if (ultra && STRONG_MARKUP.test(String(html || ""))) return;
      return Reflect.apply(nativeInsertAdjacentHTML, this, arguments);
    };
  }

  function patchUrlProperty(proto, prop, relAware = false) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.get || !desc?.set || desc.configurable === false) return;
      Object.defineProperty(proto, prop, {
        configurable:true,
        enumerable:desc.enumerable,
        get:desc.get,
        set(value) {
          const rel = relAware ? String(this.rel || "").toLowerCase() : "";
          const mayBlock = !relAware || /^(?:preload|prefetch|modulepreload)$/.test(rel);
          if (ultra && mayBlock && shouldBlock(value)) return;
          return desc.set.call(this, value);
        }
      });
    } catch (_) {}
  }
  if (globalThis.HTMLLinkElement) patchUrlProperty(HTMLLinkElement.prototype, "href", true);
  if (globalThis.HTMLMediaElement) patchUrlProperty(HTMLMediaElement.prototype, "src", false);
})();
