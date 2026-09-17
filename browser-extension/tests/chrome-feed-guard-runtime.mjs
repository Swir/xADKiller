import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-guard.js"), "utf8");
const LIVE_SHIELD = "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const TITAN = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";

function response(data) {
  return new Response(JSON.stringify(data), { status:200, headers:{ "content-type":"application/json" } });
}

async function makeGuard(payloadByUrl, storage = {}) {
  const context = {
    URL,
    Response,
    TypeError,
    console,
    globalThis:null,
    chrome:{
      storage:{
        local:{ get:(defaults, cb) => cb({ ...defaults, ...storage }) }
      }
    },
    fetch:async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      if (!(url in payloadByUrl)) return response({ ok:true });
      return response(payloadByUrl[url]);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"feed-guard.js" });
  return context;
}

async function expectReject(promise, label) {
  let rejected = false;
  try { await promise; } catch (error) {
    rejected = /xad_feed_guard_/.test(String(error?.message || error));
  }
  if (!rejected) throw new Error(`${label} was not rejected`);
}

const healthyShield = {
  schema:1, feed_version:"2026.09.17.1",
  standard_domains:Array.from({length:80}, (_,i) => `ads${i}.example.net`),
  ultra_domains:Array.from({length:60}, (_,i) => `ultra${i}.example.net`)
};
const healthyMatrix = {
  schema:1, feed_version:"2026.09.17.1",
  standard_signatures:Array.from({length:20}, (_,i) => ({ filter:`/ad-${i}/`, types:["script"] })),
  ultra_signatures:Array.from({length:12}, (_,i) => ({ filter:`/ultra-${i}/`, types:["script"] })),
  standard_cosmetic:Array.from({length:20}, (_,i) => `.ad-${i}`),
  ultra_cosmetic:Array.from({length:12}, (_,i) => `.ultra-${i}`)
};
const healthyTitan = {
  schema:1, feed_version:"2026.09.17.1",
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
}

{
  const guard = await makeGuard({ [LIVE_SHIELD]:{ ...healthyShield, schema:2 } });
  await expectReject(guard.fetch(LIVE_SHIELD), "schema mismatch");
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

console.log("[xADKiller FEED GUARD CI] PASS • schema, minimum-size and anti-shrink guards verified for Live Shield, Live Matrix and TITAN");
