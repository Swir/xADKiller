import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const FEED = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

let capturedInit = null;
let nativeCalls = 0;
const context = {
  URL, TypeError, AbortController, Response, Headers, ReadableStream, Uint8Array,
  setTimeout, clearTimeout, console, globalThis:null,
  fetch:async (_input, init) => {
    nativeCalls++;
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
    accept:"application/json, x-secret=must-not-leak",
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

const policy = context.XAD_FEED_TRANSPORT_GUARD;
const sent = new Headers(capturedInit.headers);
if (sent.get("accept") !== policy.FEED_ACCEPT) {
  throw new Error(`caller-controlled Accept value survived hardening: ${sent.get("accept")}`);
}
for (const name of ["authorization", "cookie", "proxy-authorization", "x-api-key", "x-debug-secret"]) {
  if (sent.has(name)) throw new Error(`sensitive caller header leaked to public feed: ${name}`);
}
if ([...sent.keys()].some((name) => name !== "accept")) {
  throw new Error(`unexpected caller header survived feed hardening: ${[...sent.keys()].join(",")}`);
}

const defaults = policy.hardenedInit({});
if (new Headers(defaults.headers).get("accept") !== policy.FEED_ACCEPT) {
  throw new Error("default public-data Accept header is not deterministic");
}
if (policy.publicDataHeaders({ accept:"secret/custom" }).accept !== policy.FEED_ACCEPT) {
  throw new Error("public-data header sanitizer preserved caller-controlled Accept text");
}

async function expectCanonicalReject(url, label) {
  const before = nativeCalls;
  let rejected = false;
  try { await context.fetch(url); }
  catch (error) {
    rejected = String(error?.message || error).includes("xad_feed_guard_transport_canonical_url");
  }
  if (!rejected) throw new Error(`${label} was not rejected as a noncanonical protected feed URL`);
  if (nativeCalls !== before) throw new Error(`${label} reached native fetch before canonical URL rejection`);
}

await expectCanonicalReject(`${FEED}?token=must-not-leak`, "query-string feed variant");
await expectCanonicalReject(`${FEED}#alternate-spelling`, "fragment feed variant");

if (policy.guardedKind(`${FEED}?cache=1`) !== "") throw new Error("query-string feed variant was treated as canonical");
if (!policy.hasApprovedPath(`${FEED}?cache=1`)) throw new Error("approved-path detector failed for unsafe feed variant");

console.log("[xADKiller FEED REQUEST PRIVACY CI] PASS • canonical exact URLs • deterministic Accept • no-store • no credentials/referrer • caller secrets stripped");
