(() => {
  if (globalThis.__xadPreflightGuardV1) return;
  globalThis.__xadPreflightGuardV1 = true;

  let active = true;

  const STRONG_HOST = /(^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|amazon-adsystem\.com|adnxs\.com|adsrvr\.org|pubmatic\.com|rubiconproject\.com|criteo\.(?:com|net)|taboola\.com|outbrain\.com|adcolony\.com|smartadserver\.com|adform\.net)$/i;
  const STRONG_PATHS = [
    /\/(?:ads?|adserver|adservice|ad-loader|adloader|ad-script|adscript)(?:[._\/-]|$)/i,
    /\/(?:pagead|gampad|securepubads|adsbygoogle)(?:[._\/-]|$)/i,
    /\/(?:prebid|vast|vmap|ima3)(?:[._\/-]|$)/i,
    /\/widget\/ads[._\/-]/i,
    /(?:^|[?&])(?:ad_unit|adunit|ad_slot|adslot|gdfp_req)=/i
  ];
  const TRACK_BEACON = /(?:^|[?&])(?:event|conversion|campaign|tracking|tracker|analytics|pixel|impression)=/i;

  window.addEventListener("xadkiller:preflight-config", (event) => {
    if (typeof event?.detail?.active === "boolean") active = event.detail.active;
  }, true);

  function asUrl(value) {
    try {
      if (typeof Request !== "undefined" && value instanceof Request) return new URL(value.url, location.href);
      return new URL(String(value || ""), location.href);
    } catch (_) {
      return null;
    }
  }

  function shouldBlock(value, kind = "request") {
    if (!active) return false;
    const u = asUrl(value);
    if (!u) return false;
    const protocolOk = kind === "websocket" ? /^(?:wss?|https?):$/i.test(u.protocol) : /^https?:$/i.test(u.protocol);
    if (!protocolOk) return false;
    const host = u.hostname.toLowerCase();
    const own = location.hostname && (host === location.hostname || host.endsWith("." + location.hostname));
    const pathQuery = `${u.pathname}${u.search}`;

    if (STRONG_HOST.test(host)) return true;
    if (STRONG_PATHS.some((rx) => rx.test(pathQuery))) return true;
    if (kind === "beacon" && !own && TRACK_BEACON.test(pathQuery)) return true;
    return false;
  }

  function emitBlocked(url, kind) {
    try {
      window.dispatchEvent(new CustomEvent("xadkiller:blocked", {
        detail: { kind, host: asUrl(url)?.hostname || "" }
      }));
    } catch (_) {}
  }

  const nativeFetch = globalThis.fetch;
  if (typeof nativeFetch === "function") {
    globalThis.fetch = function(input) {
      const url = typeof Request !== "undefined" && input instanceof Request ? input.url : input;
      if (shouldBlock(url, "fetch")) {
        emitBlocked(url, "fetch");
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Reflect.apply(nativeFetch, this, arguments);
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldBlock(url, "xhr")) {
      emitBlocked(url, "xhr");
      throw new DOMException("Blocked by xADKiller", "NetworkError");
    }
    return Reflect.apply(xhrOpen, this, arguments);
  };

  const nativeBeacon = navigator.sendBeacon?.bind(navigator);
  if (nativeBeacon) {
    navigator.sendBeacon = function(url, data) {
      if (shouldBlock(url, "beacon")) {
        emitBlocked(url, "beacon");
        return false;
      }
      return nativeBeacon(url, data);
    };
  }

  const NativeWebSocket = globalThis.WebSocket;
  if (typeof NativeWebSocket === "function") {
    function XadWebSocket(url, protocols) {
      if (shouldBlock(url, "websocket")) {
        emitBlocked(url, "websocket");
        throw new DOMException("Blocked by xADKiller", "SecurityError");
      }
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    }
    XadWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(XadWebSocket, NativeWebSocket);
    globalThis.WebSocket = XadWebSocket;
  }

  const NativeEventSource = globalThis.EventSource;
  if (typeof NativeEventSource === "function") {
    function XadEventSource(url, options) {
      if (shouldBlock(url, "eventsource")) {
        emitBlocked(url, "eventsource");
        throw new DOMException("Blocked by xADKiller", "SecurityError");
      }
      return new NativeEventSource(url, options);
    }
    XadEventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(XadEventSource, NativeEventSource);
    globalThis.EventSource = XadEventSource;
  }

  function patchSrc(proto, prop, kind) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.get || !desc?.set || desc.configurable === false) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) {
          if (shouldBlock(value, kind)) {
            emitBlocked(value, kind);
            try { this.dataset.xadkillerPreflight = "1"; } catch (_) {}
            queueMicrotask(() => { try { this.dispatchEvent(new Event("error")); } catch (_) {} });
            return;
          }
          return desc.set.call(this, value);
        }
      });
    } catch (_) {}
  }

  patchSrc(HTMLScriptElement.prototype, "src", "script");
  patchSrc(HTMLIFrameElement.prototype, "src", "iframe");
  patchSrc(HTMLImageElement.prototype, "src", "image");
  if (globalThis.HTMLSourceElement) patchSrc(HTMLSourceElement.prototype, "src", "source");

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const attr = String(name || "").toLowerCase();
    const tag = this.tagName?.toLowerCase?.() || "";
    if ((attr === "src" || attr === "href") && ["script","iframe","img","source"].includes(tag) && shouldBlock(value, tag)) {
      emitBlocked(value, tag);
      try { this.dataset.xadkillerPreflight = "1"; } catch (_) {}
      return;
    }
    return Reflect.apply(nativeSetAttribute, this, arguments);
  };
})();
