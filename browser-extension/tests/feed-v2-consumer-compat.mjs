import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const common = path.resolve(here, "../common");
const protectedUrl = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const otherUrl = "https://example.com/data.json";

const originalFetch = globalThis.fetch;
const originalGuard = globalThis.XAD_FEED_GUARD;
const originalTransportGuard = globalThis.XAD_FEED_TRANSPORT_GUARD;
const originalCompatApi = globalThis.XAD_FEED_V2_COMPAT;
const originalFlag = globalThis.__xadFeedV2Compat;

const v2 = {
  schema:2,
  feed_version:"2026.09.18.test",
  updated_at:"2026-09-18T00:00:00Z",
  expires_at:"2026-10-01T00:00:00Z",
  rollback:{ previous_version:"2026.09.17.test", previous_ref:"browser-intelligence/archive/test.json" },
  standard_signatures:Array.from({ length:8 }, (_, i) => ({ filter:`/ads/test-${i}`, types:["script"] })),
  standard_cosmetic:Array.from({ length:8 }, (_, i) => `.ad-test-${i}`)
};

try {
  globalThis.XAD_FEED_GUARD = {
    guardedKind(value) {
      return String(value).startsWith("https://raw.githubusercontent.com/Swir/xADKiller/") ? "live-matrix" : "";
    }
  };
  globalThis.XAD_FEED_TRANSPORT_GUARD = {
    requestUrlValue(input) {
      if (typeof input === "string") return input;
      if (input && typeof input === "object") {
        if (typeof input.url === "string" && input.url) return input.url;
        if (typeof input.href === "string" && input.href) return input.href;
      }
      return "";
    }
  };
  globalThis.fetch = async (input) => {
    const url = String(typeof input === "string" ? input : input?.url || input?.href || "");
    if (url === protectedUrl) {
      const response = new Response(JSON.stringify(v2), { status:200, headers:{ "content-type":"application/json", "x-test":"v2" } });
      try { Object.defineProperty(response, "url", { value:protectedUrl, configurable:true }); } catch (_) {}
      return response;
    }
    return new Response(JSON.stringify({ schema:2, untouched:true }), { status:200, headers:{ "x-test":"other" } });
  };
  delete globalThis.__xadFeedV2Compat;
  delete globalThis.XAD_FEED_V2_COMPAT;

  const scriptUrl = pathToFileURL(path.join(common, "feed-v2-compat.js"));
  scriptUrl.searchParams.set("test", String(Date.now()));
  await import(scriptUrl.href);

  const adaptedResponse = await globalThis.fetch(protectedUrl);
  const adapted = await adaptedResponse.json();
  assert.equal(adapted.schema, 1, "validated schema v2 must be exposed to legacy consumers as schema 1");
  assert.equal(adapted.feed_version, v2.feed_version);
  assert.equal(adapted.expires_at, v2.expires_at, "v2 expiry metadata must be preserved");
  assert.deepEqual(adapted.rollback, v2.rollback, "v2 rollback metadata must be preserved");
  assert.equal(adaptedResponse.headers.get("x-test"), "v2");
  assert.equal(adaptedResponse.url, protectedUrl, "compatibility rebuild should preserve verified response provenance metadata");

  const urlObjectResponse = await globalThis.fetch(new URL(protectedUrl));
  const urlObjectAdapted = await urlObjectResponse.json();
  assert.equal(urlObjectAdapted.schema, 1,
    "URL-object protected feed requests must receive the same validated v2-to-v1 compatibility view");
  assert.equal(urlObjectAdapted.feed_version, v2.feed_version);

  if (typeof Request === "function") {
    const requestResponse = await globalThis.fetch(new Request(protectedUrl));
    const requestAdapted = await requestResponse.json();
    assert.equal(requestAdapted.schema, 1,
      "Request-object protected feed requests must receive the same validated v2-to-v1 compatibility view");
  }

  assert.equal(globalThis.XAD_FEED_V2_COMPAT.requestUrlValue(new URL(protectedUrl)), protectedUrl,
    "adapter URL normalization must cover URL.href without weakening the transport guard");

  const untouchedResponse = await globalThis.fetch(otherUrl);
  const untouched = await untouchedResponse.json();
  assert.equal(untouched.schema, 2, "non-protected requests must not be rewritten");
  assert.equal(untouched.untouched, true);

  const serviceWorker = fs.readFileSync(path.join(common, "service-worker.js"), "utf8");
  assert.match(
    serviceWorker,
    /importScripts\("feed-transport-guard\.js",\s*"feed-data-contract\.js",\s*"feed-rollback-provenance\.js",\s*"feed-guard\.js",\s*"feed-v2-compat\.js"/,
    "Feed transport, data-contract and rollback-provenance guards must run before Feed Guard, and Feed Guard before the v2 compatibility adapter"
  );
  assert.ok(!/eval\s*\(|new\s+Function\s*\(/.test(fs.readFileSync(path.join(common, "feed-v2-compat.js"), "utf8")),
    "compatibility adapter must not execute remote code");
  assert.ok(!/eval\s*\(|new\s+Function\s*\(/.test(fs.readFileSync(path.join(common, "feed-data-contract.js"), "utf8")),
    "feed data contract must validate opaque data without executable remote code");
  assert.ok(!/eval\s*\(|new\s+Function\s*\(/.test(fs.readFileSync(path.join(common, "feed-rollback-provenance.js"), "utf8")),
    "rollback provenance guard must validate opaque metadata without executable remote code");

  console.log("Feed v2 consumer compatibility: PASS");
} finally {
  globalThis.fetch = originalFetch;
  if (originalGuard === undefined) delete globalThis.XAD_FEED_GUARD;
  else globalThis.XAD_FEED_GUARD = originalGuard;
  if (originalTransportGuard === undefined) delete globalThis.XAD_FEED_TRANSPORT_GUARD;
  else globalThis.XAD_FEED_TRANSPORT_GUARD = originalTransportGuard;
  if (originalCompatApi === undefined) delete globalThis.XAD_FEED_V2_COMPAT;
  else globalThis.XAD_FEED_V2_COMPAT = originalCompatApi;
  if (originalFlag === undefined) delete globalThis.__xadFeedV2Compat;
  else globalThis.__xadFeedV2Compat = originalFlag;
}
