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

let responseFactory = () => ({
  ok:true,
  status:200,
  url:FEED,
  redirected:false,
  headers:headers({ "content-length":"2", "content-type":"application/json" })
});
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
if (!full.ok || full.status !== 200 || nativeCalls !== 1) {
  throw new Error("canonical HTTP 200 protection feed was rejected");
}

for (const status of [204, 206]) {
  responseFactory = () => ({
    ok:true,
    status,
    url:FEED,
    redirected:false,
    headers:headers({ "content-length":"2", "content-type":"application/json" })
  });
  let rejected = false;
  try {
    await context.fetch(FEED);
  } catch (error) {
    rejected = String(error?.message || "").includes("xad_feed_guard_transport_status");
  }
  if (!rejected) throw new Error(`successful non-200 status ${status} was accepted as a complete protection feed`);
}

// Keep transient/server errors visible to Feed Guard so verified-cache fallback and
// Retry-After classification continue to work exactly as before.
responseFactory = () => ({
  ok:false,
  status:503,
  url:FEED,
  redirected:false,
  headers:headers({ "content-length":"0", "content-type":"text/html" })
});
const unavailable = await context.fetch(FEED);
if (unavailable.status !== 503) throw new Error("server failure was hidden from Feed Guard");

console.log("[xADKiller FEED STATUS CI] PASS • only complete HTTP 200 accepted as feed data • 204/206 fail closed • 5xx remains available for verified-cache fallback");
