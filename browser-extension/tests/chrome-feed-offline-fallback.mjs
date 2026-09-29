import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const guardSource = fs.readFileSync(path.join(root, "common", "feed-guard.js"), "utf8");
const matrixSource = fs.readFileSync(path.join(root, "common", "live-signatures.js"), "utf8");
const LIVE_MATRIX = "https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json";

const storage = {
  enabled:true,
  mode:"standard",
  xadLiveMatrixVersion:"known-good-v1",
  xadLiveMatrixFetchedAt:0,
  xadLiveSignaturesStandard:Array.from({ length:8 }, (_, i) => ({
    filter:`/cached-ad-${i}/`, types:["script"], thirdParty:true
  })),
  xadLiveSignaturesUltra:[],
  xadLiveCosmeticStandard:Array.from({ length:8 }, (_, i) => `.cached-ad-${i}`),
  xadLiveCosmeticUltra:[]
};

let dynamicRules = [];
let nativeFetchCalls = 0;
const installedListeners = [];
const startupListeners = [];
const alarmListeners = [];
const storageListeners = [];
const messageListeners = [];

const context = {
  URL,
  Response,
  TypeError,
  Date,
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  globalThis:null,
  fetch:async (input) => {
    const url = typeof input === "string" ? input : input?.url;
    if (String(url || "").startsWith(LIVE_MATRIX)) {
      nativeFetchCalls++;
      return new Response(JSON.stringify({ error:"simulated-github-outage" }), {
        status:503,
        headers:{ "content-type":"application/json" }
      });
    }
    return new Response(JSON.stringify({ ok:true }), { status:200 });
  },
  chrome:{
    storage:{
      local:{
        get:(defaults, cb) => cb({ ...defaults, ...storage }),
        set:(values, cb) => { Object.assign(storage, values || {}); if (cb) cb(); }
      },
      onChanged:{ addListener:(fn) => storageListeners.push(fn) }
    },
    runtime:{
      lastError:null,
      onInstalled:{ addListener:(fn) => installedListeners.push(fn) },
      onStartup:{ addListener:(fn) => startupListeners.push(fn) },
      onMessage:{ addListener:(fn) => messageListeners.push(fn) }
    },
    alarms:{
      create:() => {},
      onAlarm:{ addListener:(fn) => alarmListeners.push(fn) }
    },
    declarativeNetRequest:{
      getDynamicRules:(cb) => cb(dynamicRules.map((rule) => structuredClone(rule))),
      updateDynamicRules:(payload, cb) => {
        const remove = new Set(payload?.removeRuleIds || []);
        dynamicRules = dynamicRules.filter((rule) => !remove.has(rule.id));
        dynamicRules.push(...structuredClone(payload?.addRules || []));
        cb();
      }
    }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(guardSource, context, { filename:"feed-guard.js" });
vm.runInContext(matrixSource, context, { filename:"live-signatures.js" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(120);

if (nativeFetchCalls !== 1) {
  throw new Error(`expected one initial GitHub fetch, got ${nativeFetchCalls}`);
}
if (dynamicRules.length !== 8) {
  throw new Error(`known-good cached rules were not restored after 503: ${dynamicRules.length}`);
}
if (!dynamicRules.every((rule) => rule?.action?.type === "block" && rule.id >= 150000 && rule.id <= 150399)) {
  throw new Error("cached Live Matrix rules were not applied safely");
}

let health = await context.XAD_FEED_GUARD.readHealth();
let matrixHealth = health?.feeds?.["live-matrix"];
if (!matrixHealth || matrixHealth.failureCount !== 1 || matrixHealth.lastError !== "http_503") {
  throw new Error(`503 health was not recorded: ${JSON.stringify(matrixHealth)}`);
}
if (!(matrixHealth.nextRetryAt > Date.now()) || matrixHealth.backoffLevel !== 1) {
  throw new Error(`bounded network backoff was not armed: ${JSON.stringify(matrixHealth)}`);
}

async function sendRuntimeMessage(message) {
  for (const listener of messageListeners) {
    let settled = false;
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve({ handled:false }), 250);
      let returned;
      try {
        returned = listener(message, {}, (response) => {
          settled = true;
          clearTimeout(timeout);
          resolve({ handled:true, response });
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }
      if (returned !== true && !settled) {
        clearTimeout(timeout);
        resolve({ handled:false });
      }
    });
    if (result.handled) return result.response;
  }
  throw new Error(`no runtime listener handled ${JSON.stringify(message)}`);
}

const forced = await sendRuntimeMessage({ type:"refreshLiveMatrix" });
if (!forced?.ok || forced.version !== "known-good-v1" || forced.signatures !== 8) {
  throw new Error(`forced refresh did not fall back to validated cache: ${JSON.stringify(forced)}`);
}
if (nativeFetchCalls !== 1) {
  throw new Error(`backoff did not suppress repeated GitHub fetches: ${nativeFetchCalls}`);
}
if (dynamicRules.length !== 8) {
  throw new Error(`cached DNR protection regressed during backoff: ${dynamicRules.length}`);
}

health = await context.XAD_FEED_GUARD.readHealth();
matrixHealth = health?.feeds?.["live-matrix"];
if (matrixHealth.failureCount !== 1 || matrixHealth.consecutiveFailures !== 1) {
  throw new Error(`backoff should not inflate failure counters: ${JSON.stringify(matrixHealth)}`);
}
if (context.XAD_FEED_GUARD.backoffMs(1) !== 15_000
    || context.XAD_FEED_GUARD.backoffMs(2) !== 30_000
    || context.XAD_FEED_GUARD.backoffMs(99) !== 15 * 60_000) {
  throw new Error("network backoff schedule is not deterministic/bounded");
}

console.log("[xADKiller OFFLINE FEED CI] PASS • GitHub 503 -> validated cache remains active; bounded Feed Guard backoff suppresses repeat fetches without inflating failures");