import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const guardSource = fs.readFileSync(path.join(root, "common", "feed-guard.js"), "utf8");
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

const RealDate = Date;
let nowMs = RealDate.parse("2026-09-18T04:30:00Z");
class FakeDate extends RealDate {
  static now() { return nowMs; }
}

const storage = {
  xadLiveSignaturesStandard:Array.from({ length:8 }, (_, i) => ({
    filter:`/cached-${i}/`, types:["script"], thirdParty:true
  })),
  xadLiveSignaturesUltra:[],
  xadLiveCosmeticStandard:Array.from({ length:8 }, (_, i) => `.cached-${i}`),
  xadLiveCosmeticUltra:[]
};

const validFeed = {
  schema:1,
  feed_version:"retry-recovered-v1",
  updated_at:"2026-09-18T04:31:00Z",
  standard_signatures:Array.from({ length:8 }, (_, i) => ({
    filter:`/fresh-${i}/`, types:["script"], thirdParty:true
  })),
  ultra_signatures:[],
  standard_cosmetic:Array.from({ length:8 }, (_, i) => `.fresh-${i}`),
  ultra_cosmetic:[]
};

let mode = "rate-limit";
let nativeFetchCalls = 0;
const context = {
  URL,
  Response,
  TypeError,
  Date:FakeDate,
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  globalThis:null,
  fetch:async (input) => {
    const url = typeof input === "string" ? input : input?.url;
    if (String(url || "") !== LIVE_MATRIX) {
      return new Response(JSON.stringify({ ok:true }), { status:200 });
    }
    nativeFetchCalls++;
    if (mode === "rate-limit") {
      return new Response(JSON.stringify({ error:"rate-limited" }), {
        status:429,
        headers:{ "content-type":"application/json", "retry-after":"120" }
      });
    }
    if (mode === "abort") {
      const error = new Error("simulated abort");
      error.name = "AbortError";
      throw error;
    }
    return new Response(JSON.stringify(validFeed), {
      status:200,
      headers:{ "content-type":"application/json" }
    });
  },
  chrome:{
    storage:{
      local:{
        get:(defaults, cb) => cb({ ...defaults, ...storage }),
        set:(values, cb) => { Object.assign(storage, values || {}); if (cb) cb(); }
      }
    },
    runtime:{ onMessage:{ addListener:() => {} } }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(guardSource, context, { filename:"feed-guard.js" });

const first = await context.fetch(LIVE_MATRIX);
if (first.status !== 429 || nativeFetchCalls !== 1) {
  throw new Error(`expected one native 429 fetch, status=${first.status} calls=${nativeFetchCalls}`);
}

let health = await context.XAD_FEED_GUARD.readHealth();
let matrix = health?.feeds?.["live-matrix"];
if (!matrix || matrix.failureCount !== 1 || matrix.lastError !== "http_429") {
  throw new Error(`429 health missing: ${JSON.stringify(matrix)}`);
}
if (matrix.lastRetryAfterMs !== 120_000 || matrix.nextRetryAt - nowMs !== 120_000) {
  throw new Error(`Retry-After was not honored exactly: ${JSON.stringify(matrix)}`);
}

let blocked = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  blocked = String(error?.message || "").includes("xad_feed_guard_backoff");
}
if (!blocked || nativeFetchCalls !== 1) {
  throw new Error(`retry window did not suppress the native fetch: blocked=${blocked} calls=${nativeFetchCalls}`);
}

nowMs += 120_001;
mode = "success";
const recovered = await context.fetch(LIVE_MATRIX);
if (!recovered.ok || nativeFetchCalls !== 2) {
  throw new Error(`feed did not recover after Retry-After window: status=${recovered.status} calls=${nativeFetchCalls}`);
}
health = await context.XAD_FEED_GUARD.readHealth();
matrix = health?.feeds?.["live-matrix"];
if (matrix.successCount !== 1 || matrix.failureCount !== 1 || matrix.consecutiveFailures !== 0
    || matrix.nextRetryAt !== 0 || matrix.lastRetryAfterMs !== 0 || matrix.lastError !== "") {
  throw new Error(`successful recovery did not clear transient backoff state: ${JSON.stringify(matrix)}`);
}

mode = "abort";
let aborted = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  aborted = error?.name === "AbortError";
}
if (!aborted || nativeFetchCalls !== 3) {
  throw new Error(`AbortError was not propagated from the native fetch: aborted=${aborted} calls=${nativeFetchCalls}`);
}
health = await context.XAD_FEED_GUARD.readHealth();
matrix = health?.feeds?.["live-matrix"];
if (matrix.failureCount !== 2 || matrix.consecutiveFailures !== 1 || matrix.lastError !== "aborterror"
    || matrix.nextRetryAt - nowMs !== 15_000 || matrix.lastRetryAfterMs !== 0) {
  throw new Error(`AbortError did not arm bounded local backoff: ${JSON.stringify(matrix)}`);
}

nowMs += 15_001;
mode = "success";
const recoveredAgain = await context.fetch(LIVE_MATRIX);
if (!recoveredAgain.ok || nativeFetchCalls !== 4) {
  throw new Error(`feed did not recover after AbortError backoff: status=${recoveredAgain.status} calls=${nativeFetchCalls}`);
}
health = await context.XAD_FEED_GUARD.readHealth();
matrix = health?.feeds?.["live-matrix"];
if (matrix.successCount !== 2 || matrix.failureCount !== 2 || matrix.consecutiveFailures !== 0 || matrix.nextRetryAt !== 0) {
  throw new Error(`post-abort recovery did not reset backoff: ${JSON.stringify(matrix)}`);
}

const policy = context.XAD_FEED_GUARD;
if (policy.parseRetryAfter("1", nowMs) !== 15_000) {
  throw new Error("Retry-After minimum clamp is not 15 seconds");
}
if (policy.parseRetryAfter("999999", nowMs) !== 15 * 60_000) {
  throw new Error("Retry-After maximum clamp is not 15 minutes");
}
if (policy.parseRetryAfter("not-a-date", nowMs) !== 0) {
  throw new Error("invalid Retry-After must be ignored");
}
const dateDelay = policy.parseRetryAfter("Fri, 18 Sep 2026 04:35:00 GMT", nowMs);
if (dateDelay < 150_000 || dateDelay > 180_000) {
  throw new Error(`HTTP-date Retry-After parsed outside expected window: ${dateDelay}`);
}

console.log("[xADKiller FEED RETRY CI] PASS • 429 Retry-After honored and bounded • backoff suppresses duplicate fetch • success resets state • AbortError backoff and recovery verified");
