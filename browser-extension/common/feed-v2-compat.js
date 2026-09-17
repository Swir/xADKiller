(() => {
  if (globalThis.__xadFeedV2Compat) return;
  globalThis.__xadFeedV2Compat = true;

  const guardedFetch = globalThis.fetch.bind(globalThis);

  /**
   * Feed Guard validates the full schema-v2 contract before this adapter runs.
   * Current v1.5 consumers still expect schema=1, so a validated v2 payload is
   * presented to them through a local compatibility view while preserving all
   * v2 metadata fields. This never executes or downloads remote code.
   */
  globalThis.fetch = async (input, init) => {
    const response = await guardedFetch(input, init);
    const urlValue = typeof input === "string" ? input : input?.url;
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
    return new Response(JSON.stringify(compatible), {
      status:response.status,
      statusText:response.statusText,
      headers:new Headers(response.headers)
    });
  };
})();
