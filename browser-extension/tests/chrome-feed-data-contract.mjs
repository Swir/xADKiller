import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-data-contract.js"), "utf8");
const LIVE_SHIELD = "https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json";
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";
const TITAN = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json";

function response(data) {
  return new Response(JSON.stringify(data), { status:200, headers:{ "content-type":"application/json" } });
}

function makeGuard(payloadByUrl) {
  const context = {
    URL,
    Response,
    TypeError,
    RegExp,
    console,
    globalThis:null,
    fetch:async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      if (!(url in payloadByUrl)) return response({ untouched:true });
      return response(payloadByUrl[url]);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"feed-data-contract.js" });
  return context;
}

async function expectReject(promise, reason) {
  let message = "";
  try { await promise; } catch (error) { message = String(error?.message || error); }
  if (!message.includes(`xad_feed_guard_${reason}`)) {
    throw new Error(`expected ${reason}, got ${message || "no rejection"}`);
  }
}

const shield = {
  schema:1,
  feed_version:"test",
  updated_at:new Date().toISOString(),
  standard_domains:["ads.example.com", "track.example.net"],
  ultra_domains:["ultra.example.org"]
};
const matrix = {
  schema:1,
  feed_version:"test",
  updated_at:new Date().toISOString(),
  standard_domains:["ads.example.com"],
  standard_signatures:[{ filter:"/ads/", types:["script","xmlhttprequest"] }],
  ultra_signatures:[{ filter:"?ad_slot=", types:["sub_frame"], third_party:true }],
  standard_cosmetic:[".adsbygoogle", "[data-ad-slot]"],
  ultra_cosmetic:["[aria-label='Sponsored']"]
};
const titan = {
  schema:1,
  feed_version:"test",
  updated_at:new Date().toISOString(),
  regex_signatures:[{ regex:"(?:ads?|prebid)", types:["script","xmlhttprequest"] }],
  path_signatures:["/ads/", "/prebid.js"],
  strong_tokens:["doubleclick", "amazon-adsystem"]
};

{
  const guard = makeGuard({ [LIVE_SHIELD]:shield, [LIVE_MATRIX]:matrix, [TITAN]:titan });
  await guard.fetch(LIVE_SHIELD);
  await guard.fetch(LIVE_MATRIX);
  await guard.fetch(TITAN);
  const other = await (await guard.fetch("https://example.com/config.json")).json();
  if (!other.untouched) throw new Error("unrelated fetch was modified");
}

{
  const guard = makeGuard({ [LIVE_SHIELD]:{ ...shield, standard_domains:["https://evil.example/ad.js"] } });
  await expectReject(guard.fetch(LIVE_SHIELD), "standard_domains_domain");
}

{
  const guard = makeGuard({ [LIVE_SHIELD]:{ ...shield, standard_domains:["Ads.Example.com"] } });
  await expectReject(guard.fetch(LIVE_SHIELD), "standard_domains_domain");
}

{
  const guard = makeGuard({ [LIVE_MATRIX]:{ ...matrix, standard_signatures:[{ filter:"/ads/", types:["script","not_a_chrome_type"] }] } });
  await expectReject(guard.fetch(LIVE_MATRIX), "standard_signatures_types");
}

{
  const guard = makeGuard({ [LIVE_MATRIX]:{ ...matrix, standard_signatures:[{ filter:"/ads/", types:["script"], code:"alert(1)" }] } });
  await expectReject(guard.fetch(LIVE_MATRIX), "standard_signatures_field");
}

{
  const guard = makeGuard({ [LIVE_MATRIX]:{ ...matrix, standard_cosmetic:["body{display:none}"] } });
  await expectReject(guard.fetch(LIVE_MATRIX), "standard_cosmetic_selector");
}

{
  const guard = makeGuard({ [LIVE_MATRIX]:{ ...matrix, standard_cosmetic:["div[url(x)]"] } });
  await expectReject(guard.fetch(LIVE_MATRIX), "standard_cosmetic_selector");
}

{
  const guard = makeGuard({ [TITAN]:{ ...titan, regex_signatures:[{ regex:"(", types:["script"] }] } });
  await expectReject(guard.fetch(TITAN), "regex_signatures_regex");
}

{
  const guard = makeGuard({ [TITAN]:{ ...titan, strong_tokens:["doubleclick", "javascript:alert"] } });
  await expectReject(guard.fetch(TITAN), "strong_tokens_value");
}

{
  const contract = makeGuard({}).XAD_FEED_DATA_CONTRACT;
  if (!contract.validDomain("xn--bcher-kva.example")) throw new Error("valid punycode domain rejected");
  if (contract.validDomain("ads.example.com/path")) throw new Error("domain path accepted");
  if (!contract.validCosmeticSelector("iframe[src*='doubleclick.net']")) throw new Error("valid selector rejected");
}

console.log("[xADKiller FEED DATA CONTRACT CI] PASS • canonical domains + DNR signature schema + safe cosmetic selectors + compiled TITAN regex + opaque data-only fields verified");
