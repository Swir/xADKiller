import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const checks = read('browser-intelligence/feed-checksums.json');
const channel = read('browser-intelligence/feed-v2-production-channel.json');
const v2 = Object.fromEntries(channel.feeds.map(f => [f.id, read(f.path)]));
const feeds = Object.fromEntries(checks.feeds.map(f => {
  if (f.id !== 'live-shield') return [f.id, read(f.path)];
  const value = { ...v2[f.id], schema:1, feed_version:f.feed_version, updated_at:f.updated_at };
  delete value.expires_at; delete value.rollback;
  return [f.id, value];
}));
const urls = Object.fromEntries(checks.feeds.map(f => [f.id, `https://raw.githubusercontent.com/Swir/xADKiller/${f.source_ref}/${f.path}`]));
for (const f of checks.feeds) {
  const bytes = Buffer.from(JSON.stringify(feeds[f.id], null, 2) + '\n');
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(hash, f.git_blob_sha1, `${f.id} local candidate does not match publication manifest`);
}
// Deterministic content regression. The separate daily audit uses the real current time.
let now = Date.parse(feeds.titan.updated_at) + 300_000;
class Clock extends Date { static now() { return now; } }
const event = () => ({ addListener() {} });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(mode, payloads = feeds) {
  let rules = [], session = [];
  const messages = [];
  const storage = {
    enabled:true, mode,
    liveStandardDomains:Array(80).fill('old.example'), liveUltraDomains:Array(61).fill('old.example'),
    xadLiveSignaturesStandard:Array(19).fill({}), xadLiveSignaturesUltra:Array(24).fill({}),
    xadLiveCosmeticStandard:Array(21).fill('.old'), xadLiveCosmeticUltra:Array(14).fill('.old'),
    xadTitanFeed:{ regex:Array(4).fill({}) }
  };
  const context = {
    URL, Response, Headers, TypeError, Date:Clock, AbortController, setTimeout, clearTimeout, console,
    fetch:async input => {
      const url = String(input).split('?')[0];
      const kind = Object.keys(urls).find(k => urls[k] === url);
      return new Response(JSON.stringify(kind ? payloads[kind] : []), { headers:{'content-type':'application/json'} });
    },
    chrome:{
      storage:{ local:{get:(defaults, cb) => cb({...defaults,...storage}), set:(value,cb)=>{Object.assign(storage,value);cb?.();}}, onChanged:event() },
      runtime:{lastError:null,getURL:p=>`chrome-extension://test/${p}`,onInstalled:event(),onStartup:event(),onMessage:{addListener:f=>messages.push(f)}},
      alarms:{create(){},onAlarm:event()},
      declarativeNetRequest:{
        getDynamicRules:cb=>cb(rules), getSessionRules:cb=>cb(session),
        updateDynamicRules:(p,cb)=>{rules=rules.filter(r=>!p.removeRuleIds.includes(r.id)).concat(p.addRules);cb();},
        updateSessionRules:(p,cb)=>{session=session.filter(r=>!p.removeRuleIds.includes(r.id)).concat(p.addRules);cb();},
        isRegexSupported:async({regex})=>{new RegExp(regex);return {isSupported:true};}
      }
    }
  };
  vm.createContext(context);
  const load = name => vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/common',name),'utf8'),context,{filename:name});
  load('feed-data-contract.js'); load('feed-guard.js'); load('feed-v2-compat.js');
  return {context,storage,load,rules:()=>rules,messages};
}

const stale = structuredClone(feeds);
for (const f of Object.values(stale)) f.updated_at = '2026-09-13T15:05:00Z';
const recovery = harness('standard', stale);
for (const kind of Object.keys(feeds)) {
  await assert.rejects(recovery.context.fetch(urls[kind]), /stale_feed/);
  stale[kind] = feeds[kind];
  await recovery.context.fetch(urls[kind]);
  const health = (await recovery.context.XAD_FEED_GUARD.readHealth()).feeds[kind];
  assert.equal(health.lastError, ''); assert.equal(health.lastVersion, feeds[kind].feed_version);
  assert.equal(health.failureCount, 1); assert.equal(health.successCount, 1);
}
// New v2 data must remain acceptable after the new v1 payload, without relaxing replay checks.
for (const kind of Object.keys(feeds)) {
  stale[kind] = v2[kind];
  assert.equal((await (await recovery.context.fetch(urls[kind])).json()).schema, 1);
}

function matches(rule, url, type, thirdParty) {
  const c = rule.condition;
  if (!c.resourceTypes.includes(type) || (c.domainType === 'thirdParty' && !thirdParty)) return false;
  if (c.regexFilter) return new RegExp(c.regexFilter, 'i').test(url);
  // These curated Matrix filters are literal DNR substrings, with no ABP operators.
  assert(!/[|^*]/.test(c.urlFilter));
  return url.toLowerCase().includes(c.urlFilter.toLowerCase());
}
let checked = 0;
for (const mode of ['standard','ultra']) {
  const h = harness(mode);
  h.load('live-signatures.js'); h.load('titan-engine.js');
  const expectedMatrix = feeds['live-matrix'].standard_signatures.length + (mode === 'ultra' ? feeds['live-matrix'].ultra_signatures.length : 0);
  const expectedTitan = mode === 'ultra' ? feeds.titan.regex_signatures.length : Math.ceil(feeds.titan.regex_signatures.length * .65);
  for (let i=0; i<100 && h.rules().length !== expectedMatrix+expectedTitan; i++) await sleep(10);
  assert.equal(h.rules().length, expectedMatrix+expectedTitan, `${mode}: real consumers failed to install expected rules`);
  assert.equal(h.storage.xadLiveMatrixVersion, feeds['live-matrix'].feed_version);
  assert.equal(h.storage.xadTitanFeed.version, feeds.titan.feed_version);
  const domains = [...feeds['live-shield'].standard_domains,...(mode === 'ultra' ? feeds['live-shield'].ultra_domains : [])];
  const blocked = (url,type,thirdParty) => domains.some(d=>new URL(url).hostname === d || new URL(url).hostname.endsWith('.'+d)) || h.rules().some(r=>matches(r,url,type,thirdParty));
  const normal = [
    ['https://graph.facebook.com/v22.0/me?access_token=fixture','xmlhttprequest',true],
    ['https://business-api.tiktok.com/open_api/v1.3/user/info/','xmlhttprequest',true],
    ['https://shop.example/checkout?iu=customer123','xmlhttprequest',false],
    ['https://payments.example/checkout/session','sub_frame',true],
    ['https://accounts.example/oauth/token','xmlhttprequest',true],
    ['https://shop.example/api/ads/preferences','xmlhttprequest',false],
    ['https://video.example/commercial/trailer.mp4','media',true],
    ['https://news.example/sponsored/article.json','xmlhttprequest',true],
    ['https://news.example/promoted/article.json','xmlhttprequest',false],
    ['https://example.com/advertising/preferences','xmlhttprequest',false],
    ['https://video.example/player/content.m3u8','media',true],
    ['https://example.com/vast/library.json','xmlhttprequest',false],
    ['https://adkernel.com.example.org/content.js','script',true]
  ];
  // Ultra intentionally retains its explicit /vast/ rule; check first-party VAST against TITAN alone.
  for (const [url,type,third] of normal) {
    if (url.includes('/vast/')) assert(!h.rules().filter(r=>r.id>=160000).some(r=>matches(r,url,type,third)));
    else assert(!blocked(url,type,third), `${mode}: false positive ${url}`);
    checked++;
  }
  for (const url of ['https://adkernel.com/ad.js','https://cdn.adpone.com/banner.js','https://propellerads.com/ad.js','https://ads.example/prebid-load.js','https://ads.example/prebid-wrapper.js','https://ads.example/adserver/banner.js','https://ads.example/request?ad_unit=fixture']) {
    assert(blocked(url,'script',true), `${mode}: missed ad ${url}`); checked++;
  }
  const newPrebid = h.rules().find(r=>r.condition.regexFilter?.includes('(?:load|wrapper)'));
  assert(newPrebid, 'new TITAN prebid rule was not installed');
  assert(matches(newPrebid,'https://ads.example/prebid-wrapper.js','script',true));
  assert(!matches(newPrebid,'https://ads.example/prebid-wrapper.jsx','script',true), 'new TITAN script extension boundary');
  assert(!matches(newPrebid,'https://example.com/prebid-wrapper.js','script',false), 'new TITAN third-party boundary');
}
console.log(`PASS: publication hashes; all 3 stale-to-fresh recoveries; v1-to-v2 transition; real Matrix/TITAN consumers in both modes; ${checked} blocking/normal-request fixtures. Browser/network UI not simulated.`);
