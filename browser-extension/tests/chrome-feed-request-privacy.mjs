import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const FEED = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

let capturedInit = null;
const context = {
  URL, TypeError, AbortController, Response, Headers, ReadableStream, Uint8Array,
  setTimeout, clearTimeout, console, globalThis:null,
  fetch:async (_input, init) => {
    capturedInit = init;
    const response = new Response("{}", { status:200, headers:{ "content-type":"application/json" } });
    Object.defineProperty(response, "url", { value:FEED, configurable:true });
    return response;
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename:"feed-transport-guard.js" });

await context.fetch(FEED, {
  cache:"force-cache",
  credentials:"include",
  referrerPolicy:"unsafe-url",
  headers:{
    accept:"application/json",
    authorization:"Bearer must-not-leak",
    cookie:"sid=must-not-leak",
    "proxy-authorization":"Basic must-not-leak",
    "x-api-key":"must-not-leak",
    "x-debug-secret":"must-not-leak"
  }
});

if (!capturedInit) throw new Error("protected feed did not reach native fetch");
if (capturedInit.cache !== "no-store") throw new Error(`protected feed cache policy not forced: ${capturedInit.cache}`);
if (capturedInit.credentials !== "omit") throw new Error(`credentials not omitted: ${capturedInit.credentials}`);
if (capturedInit.referrerPolicy !== "no-referrer") throw new Error(`referrer policy not hardened: ${capturedInit.referrerPolicy}`);
if (capturedInit.redirect !== "error") throw new Error(`redirect policy not hardened: ${capturedInit.redirect}`);

const sent = new Headers(capturedInit.headers);
if (sent.get("accept") !== "application/json") throw new Error("safe Accept negotiation was not preserved");
for (const name of ["authorization", "cookie", "proxy-authorization", "x-api-key", "x-debug-secret"]) {
  if (sent.has(name)) throw new Error(`sensitive caller header leaked to public feed: ${name}`);
}
if ([...sent.keys()].some((name) => name !== "accept")) {
  throw new Error(`unexpected caller header survived feed hardening: ${[...sent.keys()].join(",")}`);
}

const policy = context.XAD_FEED_TRANSPORT_GUARD;
const defaults = policy.hardenedInit({});
if (new Headers(defaults.headers).get("accept") !== policy.FEED_ACCEPT) {
  throw new Error("default public-data Accept header is not deterministic");
}

console.log("[xADKiller FEED REQUEST PRIVACY CI] PASS • no-store • no credentials/referrer • caller secrets stripped • Accept-only public-data request headers");
