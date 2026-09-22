import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../common/feed-v2-beta-channel.js"), "utf8");
const PROD = Object.freeze({
  shield:"https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json",
  matrix:"https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json",
  titan:"https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json"
});
const PIN = "0930f563b4a4bfdef67885988485bfa8c7646784";
const PINNED = Object.freeze({
  "xadkiller-live-shield.json":{ size:3771, sha:"1e2931556cd6d888fd50da92d04266512a213fc7" },
  "xadkiller-live-matrix.json":{ size:10292, sha:"a10298b6d9004f0466bee6d601efce77d1a439a8" },
  "xadkiller-titan-feed.json":{ size:2085, sha:"ea60aa6a868b65b05f1554b89a5db3fa12d50214" }
});
const SHA_BY_SIZE = new Map(Object.values(PINNED).map(({ size, sha }) => [size, sha]));

function pinnedMeta(url) {
  if (!url.includes(`/${PIN}/browser-intelligence/v2/`)) return null;
  return PINNED[url.split("/").pop()] || null;
}

function paddedJson(size, object) {
  const json = JSON.stringify(object);
  assert.ok(Buffer.byteLength(json) <= size);
  return Buffer.from(json + " ".repeat(size - Buffer.byteLength(json)), "utf8");
}

function responseFor(url, { corruptPinned = false } = {}) {
  const meta = pinnedMeta(url);
  let body;
  if (meta) {
    body = paddedJson(meta.size, { schema:2, candidate:"pinned-v2" });
    if (corruptPinned) body = Buffer.concat([body, Buffer.from(" ", "utf8")]);
  } else {
    body = Buffer.from(JSON.stringify({ schema:1, feed_version:"production-v1-test" }), "utf8");
  }
  const response = new Response(body, { status:200, headers:{ "content-type":"application/json" } });
  Object.defineProperty(response, "url", { value:url, configurable:true });
  return response;
}

const fakeCrypto = {
  subtle:{
    async digest(name, data) {
      assert.equal(String(name).toUpperCase(), "SHA-1");
      const bytes = Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength || data.byteLength === 0 ? data.byteLength : undefined);
      const nul = bytes.indexOf(0);
      assert.ok(nul > 5, "git-blob digest input must contain header terminator");
      const header = bytes.subarray(0, nul).toString("utf8");
      const match = /^blob (\d+)$/.exec(header);
      assert.ok(match, `unexpected git-blob header: ${header}`);
      const size = Number(match[1]);
      const sha = SHA_BY_SIZE.get(size);
      assert.ok(sha, `unexpected pinned payload size ${size}`);
      return Uint8Array.from(Buffer.from(sha, "hex")).buffer;
    }
  }
};

function makeContext(state, { failPinned = false, corruptPinned = false } = {}) {
  const calls = [];
  const storage = new Map(Object.entries(state || {}));
  const mockFetch = async (input, init) => {
    const url = String(input?.url || input || "");
    calls.push({ url, init });
    if (failPinned && url.includes(`/${PIN}/`)) throw new TypeError("simulated pinned-v2 transport failure");
    return responseFor(url, { corruptPinned:corruptPinned && url.includes(`/${PIN}/`) });
  };
  const canonicalFeedUrl = (value) => {
    try {
      const url = new URL(String(value || ""));
      const allowed = new Set(Object.values(PROD));
      const clean = `${url.protocol}//${url.host}${url.pathname}`;
      return allowed.has(clean) ? clean : "";
    } catch { return ""; }
  };
  const context = vm.createContext({
    console, URL, Response, Headers, AbortController, Uint8Array, TextEncoder, setTimeout, clearTimeout,
    crypto:fakeCrypto,
    fetch:mockFetch,
    chrome:{ storage:{ local:{
      get(defaults, cb) {
        const out = { ...defaults };
        for (const key of Object.keys(defaults)) if (storage.has(key)) out[key] = storage.get(key);
        cb(out);
      },
      set(values, cb) { for (const [key, value] of Object.entries(values)) storage.set(key, value); cb?.(); }
    } } },
    XAD_FEED_TRANSPORT_GUARD:{
      FEED_FETCH_TIMEOUT_MS:15_000,
      MAX_FEED_BYTES:2 * 1024 * 1024,
      FEED_ACCEPT:"application/json,text/plain;q=0.9,application/octet-stream;q=0.8",
      requestUrlValue(input) { return typeof input === "string" ? input : input?.url || String(input || ""); },
      canonicalFeedUrl,
      requestMethod(input, init) { return String(init?.method || input?.method || "GET").toUpperCase(); },
      validateContentLength() {},
      validateCompleteRepresentation() {},
      async bufferBoundedBody(response) { return response; }
    }
  });
  vm.runInContext(source, context, { filename:"feed-v2-beta-channel.js" });
  return { context, calls, storage };
}

const now = Date.now();
const activeState = { schema:1, enabled:true, activated_at:now - 1000, expires_at:now + 60_000, pinned_ref:PIN };
const active = { xadFeedV2BetaChannelV1:activeState };

{
  const { context, calls, storage } = makeContext(active);
  for (const [name, productionUrl] of Object.entries(PROD)) {
    const before = calls.length;
    const response = await context.fetch(productionUrl, { headers:{ authorization:"secret-must-not-leak" } });
    assert.equal(calls.length - before, 2, `${name}: warm-up must verify pinned v2 then still serve production v1`);
    assert.match(calls[before].url, new RegExp(`/${PIN}/browser-intelligence/v2/xadkiller-`));
    assert.equal(calls[before].init.credentials, "omit");
    assert.equal(calls[before].init.cache, "no-store");
    assert.equal(calls[before].init.redirect, "error");
    assert.equal(calls[before].init.headers.authorization, undefined);
    assert.equal(calls[before + 1].url, productionUrl, `${name}: warm-up request must remain on exact production-v1 route`);
    assert.equal(JSON.parse(await response.text()).schema, 1, `${name}: no partial v2 bundle may leak during warm-up`);
    const runtime = storage.get("xadFeedV2BetaRuntimeV1");
    const kind = name === "shield" ? "live-shield" : name === "matrix" ? "live-matrix" : "titan";
    assert.equal(runtime?.feeds?.[kind]?.integrity, "git-blob-sha1", `${name}: exact-byte integrity evidence must be recorded`);
    assert.equal(runtime?.feeds?.[kind]?.warmup, true, `${name}: first successful verification must be marked as warm-up`);
    assert.ok(runtime?.feeds?.[kind]?.verified_at >= activeState.activated_at, `${name}: warm-up must be bound to this opt-in session`);
  }
  const runtime = storage.get("xadFeedV2BetaRuntimeV1");
  assert.equal(context.XAD_FEED_V2_BETA_CHANNEL.bundleReady(runtime, activeState, Date.now()), true, "all three exact-byte candidates must make the bundle ready");

  for (const [name, productionUrl] of Object.entries(PROD)) {
    const before = calls.length;
    const response = await context.fetch(productionUrl);
    assert.equal(calls.length - before, 1, `${name}: ready bundle must use one pinned-v2 request`);
    assert.match(calls[before].url, new RegExp(`/${PIN}/browser-intelligence/v2/xadkiller-`));
    assert.equal(JSON.parse(await response.text()).schema, 2, `${name}: coherent ready bundle may serve v2`);
  }
}

{
  const { context, calls } = makeContext(active);
  await context.fetch(PROD.shield);
  await context.fetch(PROD.matrix);
  const before = calls.length;
  const response = await context.fetch(PROD.shield);
  assert.equal(calls.length - before, 1, "already-warmed member must not be re-probed while bundle is incomplete");
  assert.equal(calls[before].url, PROD.shield, "partial warm-up must stay entirely on production v1");
  assert.equal(JSON.parse(await response.text()).schema, 1);
}

{
  const { context, calls } = makeContext({});
  await context.fetch(PROD.shield);
  assert.equal(calls[0].url, PROD.shield, "default-off channel must preserve production v1 route");
}
{
  const { context, calls } = makeContext({
    xadFeedV2BetaChannelV1:{ schema:1, enabled:true, activated_at:now - 10_000, expires_at:now - 1, pinned_ref:PIN }
  });
  await context.fetch(PROD.matrix);
  assert.equal(calls[0].url, PROD.matrix, "expired opt-in must fall back to production v1 route");
}
{
  const { context, calls, storage } = makeContext(active, { failPinned:true });
  await context.fetch(PROD.shield);
  assert.equal(calls.length, 2, "pinned-v2 warm-up failure must perform one safe production fallback");
  assert.match(calls[0].url, new RegExp(`/${PIN}/browser-intelligence/v2/xadkiller-live-shield\\.json$`));
  assert.equal(calls[1].url, PROD.shield, "fallback must restore the exact normal production-v1 request");
  const runtime = storage.get("xadFeedV2BetaRuntimeV1");
  assert.equal(runtime?.feeds?.["live-shield"]?.fallback, true, "local runtime evidence must record v1 fallback");
  assert.equal(runtime?.feeds?.["live-shield"]?.ok, false, "failed pinned transport must not be recorded as success");
  assert.equal(runtime?.feeds?.["live-shield"]?.failure_count, 1, "first transient failure must arm failure counter");
  assert.ok(runtime?.feeds?.["live-shield"]?.retry_after > now, "transient failure must arm a bounded local retry cooldown");
  assert.equal(runtime?.feeds?.["live-shield"]?.channel_disabled, false, "transient network failure must not permanently disable beta opt-in");
  await context.fetch(PROD.shield);
  assert.equal(calls.length, 3, "cooldown must bypass repeated pinned-v2 work and use production v1 directly");
  assert.equal(calls[2].url, PROD.shield);
}
{
  const { context, calls, storage } = makeContext(active, { corruptPinned:true });
  const response = await context.fetch(PROD.titan);
  assert.equal(calls.length, 2, "byte-corrupted pinned-v2 payload must fall back instead of entering Feed Guard");
  assert.equal(calls[1].url, PROD.titan);
  assert.equal(JSON.parse(await response.text()).schema, 1);
  const runtime = storage.get("xadFeedV2BetaRuntimeV1");
  assert.equal(runtime?.feeds?.titan?.integrity, "failed");
  assert.match(runtime?.feeds?.titan?.error || "", /xad_v2_beta_integrity_(size|sha1)/);
  assert.equal(runtime?.feeds?.titan?.channel_disabled, true, "deterministic integrity failure must disable this local beta opt-in");
  assert.equal(storage.get("xadFeedV2BetaChannelV1"), null, "hard failure must clear active beta state");
  await context.fetch(PROD.titan);
  assert.equal(calls.length, 3, "disabled channel must not retry the same bad immutable candidate");
  assert.equal(calls[2].url, PROD.titan);
}
{
  const { context, calls } = makeContext(active);
  await context.fetch("https://example.com/data.json");
  assert.equal(calls[0].url, "https://example.com/data.json", "unrelated fetch must remain untouched");
}
{
  const { context } = makeContext(active);
  const api = context.XAD_FEED_V2_BETA_CHANNEL;
  assert.equal(api.PINNED_REF, PIN);
  assert.deepEqual(Array.from(api.BUNDLE_KINDS), ["live-shield", "live-matrix", "titan"]);
  assert.match(api.PINNED_REF, /^[0-9a-f]{40}$/, "beta channel must pin an immutable Git commit");
  assert.equal(api.RETRY_BASE_MS, 30_000);
  assert.equal(api.RETRY_MAX_MS, 15 * 60_000);
  assert.equal(api.retryDelayMs(1), 30_000);
  assert.equal(api.retryDelayMs(2), 60_000);
  assert.equal(api.retryDelayMs(99), api.RETRY_MAX_MS);
  assert.equal(api.isHardFailureReason("xad_v2_beta_integrity_sha1"), true);
  assert.equal(api.isHardFailureReason("simulated_pinned-v2_transport_failure"), false);
  for (const target of Object.values(api.TARGETS)) {
    assert.match(target.blobSha1, /^[0-9a-f]{40}$/);
    assert.ok(Number.isSafeInteger(target.blobSize) && target.blobSize > 0);
  }
  assert.equal(api.normalizeState({ schema:1, enabled:true, activated_at:now, expires_at:now + api.MAX_SESSION_MS + 1, pinned_ref:PIN }, now), null);
  const fresh = { ok:true, integrity:"git-blob-sha1", verified_at:now + 1 };
  assert.equal(api.feedWarmForState(fresh, { ...activeState, activated_at:now }, now + 2), true);
  assert.equal(api.feedWarmForState({ ...fresh, verified_at:now - 1 }, { ...activeState, activated_at:now }, now + 2), false);
}

console.log("Chrome pinned feed-v2 beta channel: PASS (atomic 3-feed warm-up, immutable commit + exact Git-blob integrity, bounded retry, hard-failure disable, safe v1 fallback)");
