import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

function responseWithUrl(body, init, url = LIVE_MATRIX) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value:url, configurable:true });
  return response;
}

let nativeCalls = 0;
let lastInput = null;
let lastInit = null;
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
  fetch:async (input, init) => {
    nativeCalls++;
    lastInput = input;
    lastInit = init;
    return responseWithUrl(
      new Uint8Array([0x7B, 0x7D]),
      { status:200, headers:{ "content-length":"2", "content-type":"application/json" } }
    );
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename:"feed-transport-guard.js" });

const stringifiableProtected = {
  toString() { return LIVE_MATRIX; }
};
const protectedResponse = await context.fetch(stringifiableProtected, {
  credentials:"include",
  headers:{ authorization:"Bearer must-not-leak", accept:"application/json, secret=1" },
  referrer:"https://private.example/path",
  keepalive:true
});
if (!protectedResponse.ok || nativeCalls !== 1) {
  throw new Error(`stringifiable protected RequestInfo was not fetched through guard: calls=${nativeCalls}`);
}
if (lastInput !== LIVE_MATRIX) {
  throw new Error(`protected RequestInfo was not canonicalized before native fetch: ${String(lastInput)}`);
}
if (lastInit?.credentials !== "omit" || lastInit?.redirect !== "error" || lastInit?.referrerPolicy !== "no-referrer") {
  throw new Error(`stringifiable protected RequestInfo bypassed privacy policy: ${JSON.stringify(lastInit)}`);
}
if (lastInit?.keepalive !== false || lastInit?.headers?.authorization || lastInit?.headers?.accept !== context.XAD_FEED_TRANSPORT_GUARD.FEED_ACCEPT) {
  throw new Error("stringifiable protected RequestInfo leaked caller-controlled transport options");
}

let blockedPost = false;
try {
  await context.fetch(stringifiableProtected, { method:"POST" });
} catch (error) {
  blockedPost = String(error?.message || "").includes("xad_feed_guard_transport_method");
}
if (!blockedPost || nativeCalls !== 1) {
  throw new Error("stringifiable protected RequestInfo bypassed GET-only enforcement");
}

const throwingGetterProtected = {
  get url() { throw new Error("hostile url getter"); },
  get href() { throw new Error("hostile href getter"); },
  toString() { return LIVE_MATRIX; }
};
const normalized = context.XAD_FEED_TRANSPORT_GUARD.requestUrlValue(throwingGetterProtected);
if (normalized !== LIVE_MATRIX) {
  throw new Error(`throwing RequestInfo getters prevented protected-feed identity recovery: ${normalized}`);
}

await context.fetch(throwingGetterProtected);
if (nativeCalls !== 2 || lastInput !== LIVE_MATRIX || lastInit?.credentials !== "omit") {
  throw new Error("throwing getter RequestInfo was not routed through hardened canonical fetch");
}

console.log("[xADKiller REQUESTINFO CI] PASS • stringifiable RequestInfo cannot bypass canonical feed transport • hostile getters fall back safely • GET/privacy policy preserved");
