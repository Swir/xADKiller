import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-guard.js"), "utf8");
const LIVE_SHIELD = "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const TITAN = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";
const NOW_ISO = new Date().toISOString();

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers:{ "content-type":"application/json" } });
}

async function makeGuard(payloadByUrl, seed = {}) {
  const storage = { ...seed };
  const listeners = [];
  const context = {
    URL,
    Response,
    TypeError,
    Date,
    console,
    globalThis:null,
    chrome:{
      storage:{
        local:{
          get:(defaults, cb) => cb({ ...defaults, ...storage }),
          set:(values, cb) => { Object.assign(storage, values || {}); if (cb) cb(); }
        }
      },
      runtime:{
        onMessage:{ addListener:(listener) => listeners.push(listener) }
      }
    },
    fetch:async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      if (!(url in payloadByUrl)) return response({ ok:true });
      const value = payloadByUrl[url];
      if (value && typeof value === "object" && value.__status) return response(value.body || {}, value.__status);
      return response(value);
    }
  };
  context.globalThis = context;
  context.__storage = storage;
  context.__listeners = listeners;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"feed-guard.js" });
  return context;
}

async function expectReject(promise, label, reason = "") {
  let rejection = "";
  try { await promise; } catch (error) {
    rejection = String(error?.message || error);
  }
  if (!/xad_feed_guard_/.test(rejection)) throw new Error(`${label} was not rejected`);
  if (reason && !rejection.includes(`xad_feed_guard_${reason}`)) {
    throw new Error(`${label} rejected for wrong reason: ${rejection}`);
  }
}

function requireFeed(health, kind) {
  const feed = health?.feeds?.[kind];
  if (!feed) throw new Error(`missing health for ${kind}`);
  return feed;
}

const healthyShield = {
  schema:1, feed_version:"2026.09.17.1", updated_at:NOW_ISO,
  standard_domains:Array.from({length:80}, (_,i) => `ads${i}.example.net`),
  ultra_domains:Array.from({length:60}, (_,i) => `ultra${i}.example.net`)
};
const healthyMatrix = {
  schema:1, feed_version:"2026.09.17.1", updated_at:NOW_ISO,
  standard_signatures:Array.from({length:20}, (_,i) => ({ filter:`/ad-${i}/`, types:["script"] })),
  ultra_signatures:Array.from({length:12}, (_,i) => ({ filter:`/ultra-${i}/`, types:["script"] })),
  standard_cosmetic:Array.from({length:20}, (_,i) => `.ad-${i}`),
  ultra_cosmetic:Array.from({length:12}, (_,i) => `.ultra-${i}`)
};
const healthyTitan = {
  schema:1, feed_version:"2026.09.17.1", updated_at:NOW_ISO,
  regex_signatures:[
    { regex:"adserver", types:["script"] },
    { regex:"pagead", types:["xmlhttprequest"] },
    { regex:"prebid", types:["script"] },
    { regex:"commercial", types:["media"] }
  ]
};

{
  const guard = await makeGuard({ [LIVE_SHIELD]:healthyShield, [LIVE_MATRIX]:healthyMatrix, [TITAN]:healthyTitan });
  await guard.fetch(LIVE_SHIELD);
  await guard.fetch(LIVE_MATRIX);
  await guard.fetch(TITAN);
  const health = await guard.XAD_FEED_GUARD.readHealth();
  for (const kind of ["live-shield", "live-matrix", "titan"]) {
    const feed = requireFeed(health, kind);
    if (feed.successCount !== 1 || feed.failureCount !== 0 || feed.consecutiveFailures !== 0) {
      throw new Error(`bad successful health counters for ${kind}: ${JSON.stringify(feed)}`);
    }
    if (feed.lastVersion !== "2026.09.17.1" || !feed.lastSuccessAt || feed.lastError) {
      throw new Error(`bad successful health metadata for ${kind}: ${JSON.stringify(feed)}`);
    }
  }
  if (guard.__listeners.length !== 1) throw new Error("getFeedGuardHealth runtime listener missing");
}

{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ ...healthyShield, schema:2 } });
  await expectReject(guard.fetch(LIVE_SHIELD), "schema mismatch", "schema");
  const feed = requireFeed(await guard.XAD_FEED_GUARD.readHealth(), "live-shield");
  if (feed.failureCount !== 1 || feed.consecutiveFailures !== 1 || feed.lastError !== "schema") {
    throw new Error(`schema failure was not recorded safely: ${JSON.stringify(feed)}`);
  }
}

{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ ...healthyShield, updated_at:"not-a-date" } });
  await expectReject(guard.fetch(LIVE_SHIELD), "invalid feed timestamp", "updated_at");
}

{
  const stale = new Date(Date.now() - 46 * 24 * 60 * 60 * 1000).toISOString();
  const guard = await makeGuard({ [LIVE_MATRIX]:{ ...healthyMatrix, updated_at:stale } });
  await expectReject(guard.fetch(LIVE_MATRIX), "stale matrix feed", "stale_feed");
  const feed = requireFeed(await guard.XAD_FEED_GUARD.readHealth(), "live-matrix");
  if (feed.lastError !== "stale_feed") throw new Error(`stale feed health missing: ${JSON.stringify(feed)}`);
}

{
  const future = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  const guard = await makeGuard({ [TITAN]:{ ...healthyTitan, updated_at:future } });
  await expectReject(guard.fetch(TITAN), "future TITAN feed", "future_feed");
}

{
  const guard = await makeGuard({ [LIVE_MATRIX]:{ ...healthyMatrix, standard_signatures:healthyMatrix.standard_signatures.slice(0, 7) } });
  await expectReject(guard.fetch(LIVE_MATRIX), "undersized matrix");
}

{
  const guard = await makeGuard({ [TITAN]:{ ...healthyTitan, regex_signatures:[healthyTitan.regex_signatures[0]] } });
  await expectReject(guard.fetch(TITAN), "undersized titan feed");
}

{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ ...healthyShield, standard_domains:healthyShield.standard_domains.slice(0, 24) } }, {
    liveStandardDomains:Array.from({length:100}, (_,i) => `old${i}.example.net`)
  });
  await expectReject(guard.fetch(LIVE_SHIELD), "suspicious live shield shrink");
}

{
  const guard = await makeGuard({ [TITAN]:{ ...healthyTitan, regex_signatures:healthyTitan.regex_signatures.slice(0, 2) } }, {
    xadTitanFeed:{ regex:Array.from({length:10}, (_,i) => ({ regex:`old${i}` })) }
  });
  await expectReject(guard.fetch(TITAN), "suspicious titan shrink");
}

{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ __status:503, body:{ error:"temporary" } } });
  const result = await guard.fetch(LIVE_SHIELD);
  if (result.status !== 503) throw new Error("HTTP status was unexpectedly changed by Feed Guard");
  const feed = requireFeed(await guard.XAD_FEED_GUARD.readHealth(), "live-shield");
  if (feed.failureCount !== 1 || feed.lastError !== "http_503") throw new Error(`HTTP failure health missing: ${JSON.stringify(feed)}`);
}

console.log("[xADKiller FEED GUARD CI] PASS • schema/age/anti-shrink guards + local health counters verified for Live Shield, Live Matrix and TITAN");
