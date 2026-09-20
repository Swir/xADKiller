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

function responseFor(url) {
  const body = JSON.stringify({ schema:2, feed_version:"2026.09.18.1", updated_at:"2026-09-18T01:30:00Z", expires_at:"2026-10-18T01:30:00Z", rollback:{ previous_version:"2026.09.13.1", previous_ref:"main/browser-intelligence/test.json" } });
  const response = new Response(body, { status:200, headers:{ "content-type":"application/json" } });
  Object.defineProperty(response, "url", { value:url, configurable:true });
  return response;
}

function makeContext(state, { failPinned = false } = {}) {
  const calls = [];
  const storage = new Map(Object.entries(state || {}));
  const mockFetch = async (input, init) => {
    const url = String(input?.url || input || "");
    calls.push({ url, init });
    if (failPinned && url.includes(`/${PIN}/`)) throw new TypeError("simulated pinned-v2 transport failure");
    return responseFor(url);
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
const active = {
  xadFeedV2BetaChannelV1:{ schema:1, enabled:true, activated_at:now - 1000, expires_at:now + 60_000, pinned_ref:PIN }
};

for (const [name, productionUrl] of Object.entries(PROD)) {
  const { context, calls } = makeContext(active);
  const response = await context.fetch(productionUrl, { headers:{ authorization:"secret-must-not-leak" } });
  assert.equal(calls.length, 1, `${name}: expected one network call`);
  assert.match(calls[0].url, new RegExp(`/${PIN}/browser-intelligence/v2/xadkiller-`));
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(JSON.parse(await response.text()).schema, 2, `${name}: v2 must reach Feed Guard before compatibility adaptation`);
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
  assert.equal(calls.length, 2, "pinned-v2 transport failure must perform one safe production fallback");
  assert.match(calls[0].url, new RegExp(`/${PIN}/browser-intelligence/v2/xadkiller-live-shield\\.json$`));
  assert.equal(calls[1].url, PROD.shield, "fallback must restore the exact normal production-v1 request");
  const runtime = storage.get("xadFeedV2BetaRuntimeV1");
  assert.equal(runtime?.feeds?.["live-shield"]?.fallback, true, "local runtime evidence must record v1 fallback");
  assert.equal(runtime?.feeds?.["live-shield"]?.ok, false, "failed pinned transport must not be recorded as success");
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
  assert.match(api.PINNED_REF, /^[0-9a-f]{40}$/, "beta channel must pin an immutable Git commit");
  assert.equal(api.normalizeState({ schema:1, enabled:true, activated_at:now, expires_at:now + api.MAX_SESSION_MS + 1, pinned_ref:PIN }, now), null, "overlong opt-in must be rejected");
}

console.log("Chrome pinned feed-v2 beta channel: PASS (isolated immutable staging commit, default-off, 3 feeds, bounded opt-in, safe v1 fallback)");
