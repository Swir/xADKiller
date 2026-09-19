import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
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

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{ "content-type":"application/json" }
  });
}

async function makeGuard(payloads) {
  const storage = {};
  const rawCalls = [];
  const context = {
    URL,
    Request,
    Response,
    TypeError,
    Date,
    console,
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
      const lookup = url.replace(/\?v=\d{10,16}$/, "");
      return response(payloads[lookup] ?? { ok:true });
    }
  };
  context.globalThis = context;
  context.__rawCalls = rawCalls;
  vm.createContext(context);
  vm.runInContext(feedGuardSource, context, { filename:"feed-guard.js" });
  vm.runInContext(requestInfoSource, context, { filename:"feed-requestinfo-guard.js" });
  return context;
}

async function expectGuardReject(operation, reason, label) {
  let error = "";
  try {
    if (typeof operation === "function") await operation();
    else await operation;
  } catch (caught) {
    error = String(caught?.message || caught);
  }
  if (!error.includes(`xad_feed_guard_${reason}`)) {
    throw new Error(`${label} did not fail closed with ${reason}: ${error || "resolved"}`);
  }
}

// URL objects are valid Fetch RequestInfo. Before the boundary guard they could skip the
// outer Feed Guard because feed-guard.js historically inspected only string or input.url.
{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ ...healthyShield, schema:3 } });
  await expectGuardReject(() => guard.fetch(new URL(LIVE_SHIELD)), "schema", "URL-object schema bypass");
  const health = await guard.XAD_FEED_GUARD.readHealth();
  if (health?.feeds?.["live-shield"]?.lastError !== "schema") {
    throw new Error(`URL-object validation failure was not recorded: ${JSON.stringify(health)}`);
  }
}

// Web-IDL stringifiable objects must resolve to the same protected identity even if a hostile
// url getter throws. Feed Guard must still parse and reject the malformed payload.
{
  const guard = await makeGuard({ [LIVE_MATRIX]:{ ...healthyShield, updated_at:"not-a-date" } });
  const requestInfo = {
    get url() { throw new Error("hostile getter"); },
    toString() { return LIVE_MATRIX; }
  };
  await expectGuardReject(() => guard.fetch(requestInfo), "updated_at", "stringifiable RequestInfo bypass");
}

// A forged convenience property must not hide the URL that Web-IDL/native fetch will actually
// stringify. This was a genuine boundary gap: both wrappers could classify the object from a
// benign .url while native fetch resolved Symbol.toPrimitive to a protected GitHub feed.
{
  const guard = await makeGuard({ [LIVE_MATRIX]:healthyShield });
  const smuggled = {
    url:"https://example.invalid/looks-benign",
    [Symbol.toPrimitive]() { return LIVE_MATRIX; }
  };
  await expectGuardReject(
    () => guard.fetch(smuggled),
    "requestinfo_ambiguous_url",
    "conflicting RequestInfo identity"
  );
  if (guard.__rawCalls.length !== 0) {
    throw new Error("ambiguous RequestInfo reached raw network fetch");
  }
}

// The inverse conflict is equally unsafe: a protected-looking property cannot be allowed to
// sanitize a different absolute URL supplied by string conversion.
{
  const guard = await makeGuard({ [LIVE_MATRIX]:healthyShield });
  const smuggled = {
    url:LIVE_MATRIX,
    toString() { return "https://example.invalid/other"; }
  };
  await expectGuardReject(
    () => guard.fetch(smuggled),
    "requestinfo_ambiguous_url",
    "inverse conflicting RequestInfo identity"
  );
  if (guard.__rawCalls.length !== 0) {
    throw new Error("inverse ambiguous RequestInfo reached raw network fetch");
  }
}

// A real Request keeps the security-sensitive method/signal fields when converted to a string
// identity. The inner Feed Transport Guard therefore still sees POST and rejects it in the
// production service-worker stack rather than silently converting it to GET.
{
  const guard = await makeGuard({});
  const request = new Request(TITAN, { method:"POST", body:"not-feed-data" });
  const normalized = guard.XAD_FEED_REQUESTINFO_GUARD.normalizedProtectedInit(request, undefined);
  if (String(normalized.method || "").toUpperCase() !== "POST" || normalized.signal !== request.signal) {
    throw new Error("Request method/signal were not preserved for the inner transport guard");
  }
}

// A protocol downgrade sharing an otherwise protected feed identity must fail closed before
// reaching even the Feed Guard/native network layer. This guard intentionally throws
// synchronously, so expectGuardReject accepts a thunk and covers both sync and async failures.
{
  const guard = await makeGuard({});
  await expectGuardReject(
    () => guard.fetch(LIVE_SHIELD.replace("https://", "http://")),
    "transport_canonical_url",
    "HTTP downgrade"
  );
  if (guard.__rawCalls.length !== 0) throw new Error("HTTP downgrade reached raw network fetch");
}

// Healthy URL and Request forms remain compatible with the schema guard. Cache-buster syntax
// is preserved for the already-tested inner transport guard to canonicalize before I/O.
{
  const guard = await makeGuard({ [LIVE_SHIELD]:healthyShield });
  const result = await guard.fetch(new Request(`${LIVE_SHIELD}?v=1234567890123`));
  if (!result.ok) throw new Error("healthy RequestInfo was rejected");
  if (guard.__rawCalls.length !== 1 || !guard.__rawCalls[0].url.startsWith(LIVE_SHIELD)) {
    throw new Error(`healthy protected RequestInfo missed Feed Guard: ${JSON.stringify(guard.__rawCalls)}`);
  }
  const health = await guard.XAD_FEED_GUARD.readHealth();
  if (health?.feeds?.["live-shield"]?.lastVersion !== healthyShield.feed_version) {
    throw new Error(`healthy RequestInfo did not update feed health: ${JSON.stringify(health)}`);
  }
}

console.log("[xADKiller FEED REQUESTINFO SCHEMA BOUNDARY CI] PASS • URL/Request/stringifiable identities cannot bypass schema/anti-replay guard • conflicting absolute identities fail closed before network • method/signal remain available to inner transport gate");
