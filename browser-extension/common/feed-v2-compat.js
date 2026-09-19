(() => {
  if (globalThis.__xadFeedV2Compat) return;
  globalThis.__xadFeedV2Compat = true;

  const guardedFetch = globalThis.fetch.bind(globalThis);

  function requestUrlValue(input) {
    // Keep protected-feed identity normalization aligned with the transport guard. Fetch
    // accepts strings, Request objects and URL objects; schema-v2 compatibility must not
    // silently disappear just because a caller uses fetch(new URL(...)).
    try {
      const normalized = globalThis.XAD_FEED_TRANSPORT_GUARD?.requestUrlValue?.(input);
      if (typeof normalized === "string" && normalized) return normalized;
    } catch (_) {}
    if (typeof input === "string") return input;
    if (input && typeof input === "object") {
      if (typeof input.url === "string" && input.url) return input.url;
      if (typeof input.href === "string" && input.href) return input.href;
    }
    return "";
  }

  /**
   * Feed Guard validates the full schema-v2 contract before this adapter runs.
   * Current v1.5 consumers still expect schema=1, so a validated v2 payload is
   * presented to them through a local compatibility view while preserving all
   * v2 metadata fields. This never executes or downloads remote code.
   */
  globalThis.fetch = async (input, init) => {
    const response = await guardedFetch(input, init);
    const urlValue = requestUrlValue(input);
    const guard = globalThis.XAD_FEED_GUARD;
    const kind = guard?.guardedKind?.(urlValue) || "";
    if (!kind || !response?.ok) return response;

    let data;
    try {
      data = JSON.parse(await response.clone().text());
    } catch (_) {
      return response;
    }
    if (data?.schema !== 2) return response;

    const compatible = { ...data, schema:1 };
    const adapted = new Response(JSON.stringify(compatible), {
      status:response.status,
      statusText:response.statusText,
      headers:new Headers(response.headers)
    });
    // Preserve useful fetch metadata for legacy readers/debugging after the local schema view
    // is rebuilt. Provenance has already been verified by the transport/feed guards.
    try { Object.defineProperty(adapted, "url", { value:String(response.url || ""), configurable:true }); } catch (_) {}
    try { Object.defineProperty(adapted, "redirected", { value:Boolean(response.redirected), configurable:true }); } catch (_) {}
    return adapted;
  };

  globalThis.XAD_FEED_V2_COMPAT = Object.freeze({ requestUrlValue });
})();
