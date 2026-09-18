import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const TITAN = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";

let nativeCalls = 0;
let lastInit = null;
let responseFactory = () => ({
  ok:true,
  status:200,
  url:`${LIVE_MATRIX}?v=123`,
  redirected:false,
  headers:{ get:(name) => String(name).toLowerCase() === "content-length" ? "1024" : null }
});

const context = {
  URL,
  TypeError,
  console,
  globalThis:null,
  fetch:async (_input, init) => {
    nativeCalls++;
    lastInit = init;
    return responseFactory();
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename:"feed-transport-guard.js" });

const first = await context.fetch(`${LIVE_MATRIX}?v=123`, { cache:"no-store", headers:{ accept:"application/json" } });
if (!first.ok || nativeCalls !== 1) throw new Error(`approved feed request failed: calls=${nativeCalls}`);
if (lastInit?.redirect !== "error" || lastInit?.credentials !== "omit" || lastInit?.referrerPolicy !== "no-referrer") {
  throw new Error(`protected fetch did not enforce transport privacy: ${JSON.stringify(lastInit)}`);
}
if (lastInit?.cache !== "no-store" || lastInit?.headers?.accept !== "application/json") {
  throw new Error("caller fetch options were not preserved while hardening transport");
}

let blockedMethod = false;
try {
  await context.fetch(LIVE_MATRIX, { method:"POST" });
} catch (error) {
  blockedMethod = String(error?.message || "").includes("xad_feed_guard_transport_method");
}
if (!blockedMethod || nativeCalls !== 1) throw new Error("non-GET protected feed request reached native fetch");

responseFactory = () => ({
  ok:true,
  status:200,
  url:TITAN,
  redirected:false,
  headers:{ get:() => "256" }
});
let blockedProvenance = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  blockedProvenance = String(error?.message || "").includes("xad_feed_guard_transport_provenance");
}
if (!blockedProvenance || nativeCalls !== 2) throw new Error("cross-feed final URL provenance mismatch was accepted");

responseFactory = () => ({
  ok:true,
  status:200,
  url:LIVE_MATRIX,
  redirected:true,
  headers:{ get:() => "256" }
});
let blockedRedirect = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  blockedRedirect = String(error?.message || "").includes("xad_feed_guard_transport_redirect");
}
if (!blockedRedirect || nativeCalls !== 3) throw new Error("redirected protected response was accepted");

responseFactory = () => ({
  ok:true,
  status:200,
  url:LIVE_MATRIX,
  redirected:false,
  headers:{ get:(name) => String(name).toLowerCase() === "content-length" ? String(2 * 1024 * 1024 + 1) : null }
});
let blockedOversize = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  blockedOversize = String(error?.message || "").includes("xad_feed_guard_payload_size");
}
if (!blockedOversize || nativeCalls !== 4) throw new Error("oversized declared feed body was accepted");

responseFactory = () => ({
  ok:true,
  status:200,
  url:LIVE_MATRIX,
  redirected:false,
  headers:{ get:(name) => String(name).toLowerCase() === "content-length" ? "12x" : null }
});
let blockedLength = false;
try {
  await context.fetch(LIVE_MATRIX);
} catch (error) {
  blockedLength = String(error?.message || "").includes("xad_feed_guard_content_length");
}
if (!blockedLength || nativeCalls !== 5) throw new Error("invalid Content-Length was accepted");

lastInit = null;
responseFactory = () => ({ ok:true, status:200, url:"https://example.com/data.json", redirected:false, headers:{ get:() => null } });
await context.fetch("https://example.com/data.json", { credentials:"include" });
if (nativeCalls !== 6 || lastInit?.credentials !== "include") throw new Error("non-feed fetch was unexpectedly modified");

const policy = context.XAD_FEED_TRANSPORT_GUARD;
if (policy.guardedKind(`${LIVE_MATRIX}?cache=1`) !== "live-matrix") throw new Error("approved query-string feed URL not recognized");
if (policy.guardedKind("http://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json")) throw new Error("non-HTTPS feed URL accepted");
if (policy.guardedKind("https://raw.githubusercontent.com.evil.example/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json")) throw new Error("lookalike raw GitHub host accepted");

console.log("[xADKiller FEED TRANSPORT CI] PASS • GET-only • redirect denied • credentials/referrer omitted • provenance pinned • Content-Length bounded • non-feed fetch untouched");
