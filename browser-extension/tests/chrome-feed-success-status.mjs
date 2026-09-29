import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const FEED = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get:(name) => normalized[String(name).toLowerCase()] ?? null };
}

function readableResponse(status, body = "{}", contentType = "application/json") {
  const payload = status === 204 ? null : body;
  const byteLength = payload == null ? 0 : new TextEncoder().encode(payload).byteLength;
  const response = new Response(payload, {
    status,
    headers:{ "content-length":String(byteLength), "content-type":contentType }
  });
  Object.defineProperty(response, "url", { value:FEED, configurable:true });
  Object.defineProperty(response, "redirected", { value:false, configurable:true });
  return response;
}

let responseFactory = () => readableResponse(200);
let nativeCalls = 0;

const context = {
  URL,
  TypeError,
  AbortController,
  Response,
  Headers,
  ReadableStream,
  Uint8Array,
  setTimeout,
  clearTimeout,
  console,
  globalThis:null,
  fetch:async () => {
    nativeCalls++;
    return responseFactory();
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename:"feed-transport-guard.js" });

const full = await context.fetch(FEED);
if (!full.ok || full.status !== 200 || nativeCalls !== 1 || await full.text() !== "{}") {
  throw new Error("canonical readable HTTP 200 protection feed was rejected or corrupted");
}

for (const status of [204, 206]) {
  responseFactory = () => readableResponse(status);
  let rejected = false;
  try {
    await context.fetch(FEED);
  } catch (error) {
    rejected = String(error?.message || "").includes("xad_feed_guard_transport_status");
  }
  if (!rejected) throw new Error(`successful non-200 status ${status} was accepted as a complete protection feed`);
}

// A nominal HTTP 200 without a readable body must fail closed. This regression keeps the
// status fixture aligned with the transport contract instead of accidentally weakening it.
responseFactory = () => ({
  ok:true,
  status:200,
  url:FEED,
  redirected:false,
  headers:headers({ "content-length":"2", "content-type":"application/json" })
});
let unreadableRejected = false;
try {
  await context.fetch(FEED);
} catch (error) {
  unreadableRejected = String(error?.message || "").includes("xad_feed_guard_transport_body");
}
if (!unreadableRejected) throw new Error("unreadable HTTP 200 protection feed body was accepted");

// Keep transient/server errors visible to Feed Guard so verified-cache fallback and
// Retry-After classification continue to work exactly as before.
responseFactory = () => readableResponse(503, "service unavailable", "text/html");
const unavailable = await context.fetch(FEED);
if (unavailable.status !== 503 || await unavailable.text() !== "service unavailable") {
  throw new Error("server failure was hidden or corrupted before Feed Guard classification");
}

console.log("[xADKiller FEED STATUS CI] PASS • readable complete HTTP 200 accepted • unreadable 200 + 204/206 fail closed • 5xx remains available for verified-cache fallback");
