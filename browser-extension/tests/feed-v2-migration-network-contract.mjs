import assert from "node:assert/strict";
import {
  FEED_ACCEPT,
  MAX_FEED_BYTES,
  buildPinnedUrl,
  fetchPinnedJson,
  validatePinnedSource
} from "../tools/feed-v2-network-contract.mjs";

const pinned = {
  id:"live-matrix",
  source_ref:"main",
  path:"browser-intelligence/xadkiller-live-shield.json"
};
const expectedUrl = buildPinnedUrl(pinned);
const healthyText = JSON.stringify({ schema:1, feed_version:"test", updated_at:"2026-09-19T00:00:00Z", rules:[] });

function responseOf(body, { url = expectedUrl, status = 200, redirected = false, headers = {} } = {}) {
  const base = new Response(body, {
    status,
    headers:{ "content-type":"application/json", ...headers }
  });
  return {
    ok:status >= 200 && status < 300,
    status,
    redirected,
    url,
    headers:base.headers,
    body:base.body
  };
}

async function expectReject(operation, pattern, label) {
  let caught = null;
  try { await operation(); } catch (error) { caught = error; }
  if (!caught) throw new Error(`${label}: expected rejection`);
  assert.match(String(caught.message || caught), pattern, label);
}

{
  let seenInit = null;
  const result = await fetchPinnedJson(pinned, async (url, init) => {
    assert.equal(url, expectedUrl);
    seenInit = init;
    return responseOf(healthyText, { headers:{ "content-length":String(Buffer.byteLength(healthyText)) } });
  });
  assert.equal(result.json.schema, 1);
  assert.equal(result.actualBytes, Buffer.byteLength(healthyText));
  assert.equal(seenInit.method, "GET");
  assert.equal(seenInit.redirect, "error");
  assert.equal(seenInit.credentials, "omit");
  assert.equal(seenInit.cache, "no-store");
  assert.equal(seenInit.referrerPolicy, "no-referrer");
  assert.equal(seenInit.headers.accept, FEED_ACCEPT);
}

assert.deepEqual(validatePinnedSource(pinned), {
  id:"live-matrix",
  sourceRef:"main",
  path:"browser-intelligence/xadkiller-live-shield.json"
});
await expectReject(() => Promise.resolve(validatePinnedSource({ ...pinned, source_ref:"refs/heads/main" })), /unsafe source_ref/, "slash-bearing ref");
await expectReject(() => Promise.resolve(validatePinnedSource({ ...pinned, path:"../secret.json" })), /unsafe source path/, "parent traversal");
await expectReject(() => Promise.resolve(validatePinnedSource({ ...pinned, path:"browser-intelligence/feed.json?raw=1" })), /unsafe source path/, "query-bearing path");

await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf(healthyText, { redirected:true })),
  /redirected production response/,
  "redirect rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf(healthyText, { url:"https://example.invalid/feed.json" })),
  /provenance mismatch/,
  "provenance rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf(healthyText, { headers:{ "content-type":"text/html" } })),
  /unapproved MIME/,
  "MIME rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf("{}", { headers:{ "content-length":String(MAX_FEED_BYTES + 1) } })),
  /declared body exceeds 2 MiB ceiling/,
  "declared size rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf("{}", { headers:{ "content-length":"99" } })),
  /does not match delivered body/,
  "truncated transfer rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf("x".repeat(MAX_FEED_BYTES + 1), { headers:{ "content-type":"application/json" } })),
  /streamed body exceeds 2 MiB ceiling/,
  "streamed size rejection"
);
await expectReject(
  () => fetchPinnedJson(pinned, async () => responseOf("{not-json}")),
  /not valid JSON/,
  "JSON rejection"
);

console.log("[xADKiller FEED V2 MIGRATION NETWORK CONTRACT CI] PASS • exact raw GitHub provenance • no redirects • approved MIME • 2 MiB streamed ceiling • exact unencoded length • strict UTF-8/JSON • deterministic public GET privacy init");
