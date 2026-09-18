import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "common", "feed-cache-integrity.js"), "utf8");
const store = {};

function finish(value, callback) {
  if (typeof callback === "function") { queueMicrotask(() => callback(value)); return undefined; }
  return Promise.resolve(value);
}

const local = {
  get(keys, callback) {
    let out = {};
    if (keys == null) out = { ...store };
    else if (typeof keys === "string") { if (Object.hasOwn(store, keys)) out[keys] = store[keys]; }
    else if (Array.isArray(keys)) for (const key of keys) { if (Object.hasOwn(store, key)) out[key] = store[key]; }
    else for (const [key, fallback] of Object.entries(keys || {})) out[key] = Object.hasOwn(store, key) ? store[key] : fallback;
    return finish(out, callback);
  },
  set(values, callback) { Object.assign(store, values || {}); return finish(undefined, callback); },
  remove(keys, callback) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key]; return finish(undefined, callback); }
};

const context = vm.createContext({
  chrome:{ storage:{ local }, runtime:{} },
  crypto:webcrypto,
  TextEncoder,
  console,
  queueMicrotask,
  setTimeout,
  clearTimeout
});
vm.runInContext(source, context, { filename:"feed-cache-integrity.js" });

const legacyShield = {
  liveFeedVersion:"2026.09.13.1",
  liveFeedUpdatedAt:"2026-09-13T00:00:00Z",
  liveFeedFetchedAt:123,
  liveStandardDomains:["ads.example"],
  liveUltraDomains:["tracker.example"]
};
Object.assign(store, legacyShield);

const first = await local.get({ liveFeedVersion:"", liveStandardDomains:[] });
assert.equal(first.liveFeedVersion, legacyShield.liveFeedVersion, "legacy cache must remain usable during first integrity upgrade");
assert.deepEqual(first.liveStandardDomains, legacyShield.liveStandardDomains);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(store.xadCacheDigestLiveShieldV1 || "", /^[a-f0-9]{64}$/, "legacy cache should be sealed with SHA-256");

store.liveStandardDomains.push("tampered.example");
const tamperedShield = await local.get({ liveFeedVersion:"", liveStandardDomains:[] });
assert.equal(tamperedShield.liveFeedVersion, "");
assert.deepEqual(tamperedShield.liveStandardDomains, []);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(Object.hasOwn(store, "liveFeedVersion"), false);
assert.equal(Object.hasOwn(store, "xadCacheDigestLiveShieldV1"), false);

await local.set({
  xadLiveMatrixVersion:"matrix-1",
  xadLiveMatrixFetchedAt:456,
  xadLiveSignaturesStandard:[{ filter:"/ads/", types:["script"] }],
  xadLiveSignaturesUltra:[],
  xadLiveCosmeticStandard:[".ad"],
  xadLiveCosmeticUltra:[]
});
assert.match(store.xadCacheDigestLiveMatrixV1 || "", /^[a-f0-9]{64}$/);
const matrix = await local.get(["xadLiveMatrixVersion","xadLiveCosmeticStandard"]);
assert.equal(matrix.xadLiveMatrixVersion, "matrix-1");
assert.deepEqual(matrix.xadLiveCosmeticStandard, [".ad"]);

store.xadLiveMatrixVersion = "evil-rewrite";
const brokenMatrix = await local.get({ xadLiveMatrixVersion:"", xadLiveCosmeticStandard:[] });
assert.equal(brokenMatrix.xadLiveMatrixVersion, "");
assert.deepEqual(brokenMatrix.xadLiveCosmeticStandard, []);

await local.set({ xadTitanFeed:{ version:"titan-1", regex:[{ regex:"ads", types:["script"] }] }, xadTitanFetchedAt:789 });
assert.match(store.xadCacheDigestTitanV1 || "", /^[a-f0-9]{64}$/);
store.xadTitanFeed.regex[0].regex = "changed";
const brokenTitan = await local.get({ xadTitanFeed:null, xadTitanFetchedAt:0 });
assert.equal(brokenTitan.xadTitanFeed, null);
assert.equal(brokenTitan.xadTitanFetchedAt, 0);

await local.set({ unrelatedPreference:"ultra" });
assert.equal((await local.get("unrelatedPreference")).unrelatedPreference, "ultra", "unrelated storage must pass through unchanged");
assert.equal(Object.hasOwn(await local.get(null), "xadCacheDigestLiveMatrixV1"), false, "internal digest keys must not leak through get(null)");

console.log("OK: protection-feed fallback cache SHA-256 integrity, legacy sealing, tamper purge and storage isolation verified");
