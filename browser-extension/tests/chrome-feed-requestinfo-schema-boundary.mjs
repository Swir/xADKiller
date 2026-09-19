import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const transportSource = fs.readFileSync(path.join(root, "common", "feed-transport-guard.js"), "utf8");
const feedGuardSource = fs.readFileSync(path.join(root, "common", "feed-guard.js"), "utf8");
const requestInfoSource = fs.readFileSync(path.join(root, "common", "feed-requestinfo-guard.js"), "utf8");

const LIVE_SHIELD = "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const TITAN = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";

const healthyShield = {
  schema:1,
  feed_version:"2026.09.19.1",
  updated_at:new Date().toISOString(),
  standard_domains:Array.from({ length:80 }, (_, i) => `ads${i}.example.net`),
  ultra_domains:Array.from({ length:60 }, (_, i) => `ultra${i}.example.net`)
};

function responseFor(url, data, status = 200) {
  const response = new Response(JSON.stringify(data), {
    status,
    headers:{ "content-type":"application/json" }
  });
  Object.defineProperty(response, "url", { value:url, configurable:true });
  return response;
}

async function makeLayeredGuard(payloads) {
  const storage = {};
  const rawCalls = [];
  const context = {
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    Uint8Array,
    TypeError,
    Date,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    globalThis:null,
    chrome:{
      storage:{
        local:{
          get:(defaults, cb) => cb({ ...defaults, ...storage }),
          set:(values, cb) => { Object.assign(storage, values || {}); cb?.(); }
        }
      },
      runtime:{ onMessage:{ addListener:() => {} } }
    },
    fetch:async (input, init) => {
      const url = typeof input === "string" ? input : String(input);
      rawCalls.push({ url, init });
      const payload = payloads[url] ?? { ok:true };
      return responseFor(url, payload);
    }
  };
  context.globalThis = context;
  context.__storage = storage;
  context.__rawCalls = rawCalls;
  vm.createContext(context);
  vm.runInContext(transportSource, context, { filename:"feed-transport-guard.js" });
  vm.runInContext(feedGuardSource, context, { filename:"feed-guard.js" });
  vm.runInContext(requestInfoSource, context, { filename:"feed-requestinfo-guard.js" });
  return context;
}

async function expectGuardReject(promise, reason, label) {
  let error = "";
  try { await promise; } catch (caught) { error = String(caught?.message || caught); }
  if (!error.includes(`xad_feed_guard_${reason}`)) {
    throw new Error(`${label} did not fail closed with ${reason}: ${error || "resolved"}`);
  }
}

// URL objects are valid Fetch RequestInfo. They previously reached the transport layer but
// could skip the outer schema/anti-replay Feed Guard because that wrapper only read input.url.
{
  const guard = await makeLayeredGuard({ [LIVE_SHIELD]:{ ...healthyShield, schema:3 } });
  await expectGuardReject(guard.fetch(new URL(LIVE_SHIELD)), "schema", "URL-object schema bypass");
  const health = await guard.XAD_FEED_GUARD.readHealth();
  if (health?.feeds?.["live-shield"]?.lastError !== "schema") {
    throw new Error(`URL-object validation failure was not recorded: ${JSON.stringify(health)}`);
  }
}

// Web-IDL stringifiable objects must resolve to the same protected identity even if a hostile
// url getter throws. Otherwise a caller could bypass Feed Guard while Transport Guard still
// recognizes the same endpoint through String(input).
{
  const guard = await makeLayeredGuard({ [LIVE_MATRIX]:{ ...healthyShield, updated_at:"not-a-date" } });
  const requestInfo = {
    get url() { throw new Error("hostile getter"); },
    toString() { return LIVE_MATRIX; }
  };
  await expectGuardReject(guard.fetch(requestInfo), "updated_at", "stringifiable RequestInfo bypass");
}

// A real Request must retain its effective method when normalized. POST must still hit the
// inner deterministic transport method gate rather than being silently rewritten into GET.
{
  const guard = await makeLayeredGuard({ [TITAN]:healthyShield });
  const request = new Request(TITAN, { method:"POST", body:"not-feed-data" });
  await expectGuardReject(guard.fetch(request), "transport_method", "Request method preservation");
  if (guard.__rawCalls.length !== 0) throw new Error("POST protected Request reached raw network fetch");
}

// A downgrade/credential/port/hash variant sharing a protected path is still protected
// identity and must fail closed before any network request.
{
  const guard = await makeLayeredGuard({});
  await expectGuardReject(
    guard.fetch(LIVE_SHIELD.replace("https://", "http://")),
    "transport_canonical_url",
    "HTTP downgrade"
  );
  if (guard.__rawCalls.length !== 0) throw new Error("HTTP downgrade reached raw network fetch");
}

// Healthy canonical RequestInfo remains compatible and the raw request is still the hardened
// canonical GET emitted by Feed Transport Guard.
{
  const guard = await makeLayeredGuard({ [LIVE_SHIELD]:healthyShield });
  const response = await guard.fetch(new Request(`${LIVE_SHIELD}?v=1234567890123`));
  if (!response.ok) throw new Error("healthy RequestInfo was rejected");
  if (guard.__rawCalls.length !== 1 || guard.__rawCalls[0].url !== LIVE_SHIELD) {
    throw new Error(`canonical feed I/O mismatch: ${JSON.stringify(guard.__rawCalls)}`);
  }
  if (String(guard.__rawCalls[0].init?.method || "").toUpperCase() !== "GET") {
    throw new Error("hardened protected Request did not remain GET");
  }
}

console.log("[xADKiller FEED REQUESTINFO SCHEMA BOUNDARY CI] PASS • URL/Request/stringifiable identities cannot bypass transport + schema/anti-replay guard");
