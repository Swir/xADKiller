import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const rulesPath = path.join(root, "common", "rules");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadHosts(fileName) {
  const file = path.join(rulesPath, fileName);
  const hosts = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
  const unique = [...new Set(hosts)];
  if (unique.length !== hosts.length) throw new Error(`${fileName} contains duplicate hosts`);
  for (const host of unique) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) {
      throw new Error(`${fileName} contains invalid host: ${host}`);
    }
  }
  return unique;
}

const STANDARD_HOSTS = loadHosts("screenshot-standard-third-party.txt");
const ULTRA_ONLY_HOSTS = loadHosts("screenshot-ultra-third-party.txt");

// These rows were visible as misses in the same manual report but are deliberately
// not promoted to blanket host blocks because doing so can break media playback,
// checkout/fraud prevention, feature flags, cloud service routing or first-party apps.
const RISKY_EXCLUSIONS = new Set([
  "s.youtube.com",
  "redirector.googlevideo.com",
  "g.jwpsrv.com",
  "ssl.p.jwpcdn.com",
  "grs.hicloud.com",
  "c.bing.com",
  "siftscience.com",
  "cdn.siftscience.com",
  "events.launchdarkly.com",
  "clientstream.launchdarkly.com",
  "vk.com"
]);

if (STANDARD_HOSTS.length < 61) throw new Error(`STANDARD screenshot fixture unexpectedly shrank: ${STANDARD_HOSTS.length}`);
if (ULTRA_ONLY_HOSTS.length < 23) throw new Error(`ULTRA screenshot fixture unexpectedly shrank: ${ULTRA_ONLY_HOSTS.length}`);
for (const host of [...STANDARD_HOSTS, ...ULTRA_ONLY_HOSTS]) {
  if (RISKY_EXCLUSIONS.has(host)) throw new Error(`risky manual miss must not be blanket-blocked: ${host}`);
}

function casesFor(hosts) {
  return hosts.map((host) => [`https://${host}/xadkiller-screen-regression/pixel?ad=1`, "xmlhttprequest"]);
}

async function findWorker(browser, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const probe = await worker.evaluate(() => ({
          id: chrome.runtime.id,
          manifest: chrome.runtime.getManifest(),
          hasTest: typeof chrome.declarativeNetRequest?.testMatchOutcome === "function"
        }));
        if (probe?.manifest?.permissions?.includes("declarativeNetRequest")) return { worker, ...probe };
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not found");
}

async function match(worker, rows) {
  return worker.evaluate(async (items) => {
    const out = [];
    for (const [url, type] of items) {
      const result = await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        initiator: "https://publisher.xad.test",
        type
      });
      const matchedRules = Array.isArray(result?.matchedRules) ? result.matchedRules : [];
      out.push({ url, matched: matchedRules.length > 0, matchedRules });
    }
    return out;
  }, rows);
}

function assertComplete(label, rows) {
  const misses = rows.filter((row) => !row.matched);
  const hits = rows.length - misses.length;
  const pct = rows.length ? 100 * hits / rows.length : 0;
  console.log(`[xADKiller SCREEN] ${label} ${pct.toFixed(1)}% (${hits}/${rows.length})`);
  if (misses.length) {
    console.log(`[xADKiller SCREEN] misses: ${misses.map((x) => x.url).join(" | ")}`);
    throw new Error(`${label} screenshot-derived coverage regressed: ${hits}/${rows.length}`);
  }
  return { hits, total: rows.length, pct };
}

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    timeout: 60000
  });

  const { worker, id, hasTest } = await findWorker(browser);
  if (!hasTest) throw new Error("chrome.declarativeNetRequest.testMatchOutcome unavailable");
  await delay(1800);

  const standard = assertComplete("STANDARD manual-screenshot core", await match(worker, casesFor(STANDARD_HOSTS)));

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: "domcontentloaded", timeout: 12000 });
  const modeResult = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type: "setMode", mode: "ultra" }));
  if (!modeResult?.ok) throw new Error(`could not enable ULTRA: ${JSON.stringify(modeResult)}`);
  await delay(1800);

  const ultraCore = assertComplete("ULTRA manual-screenshot core", await match(worker, casesFor(STANDARD_HOSTS)));
  const ultraExtra = assertComplete("ULTRA manual-screenshot aggressive", await match(worker, casesFor(ULTRA_ONLY_HOSTS)));

  console.log(`[xADKiller SCREEN] PASS • STANDARD=${standard.hits}/${standard.total} • ULTRA-core=${ultraCore.hits}/${ultraCore.total} • ULTRA-extra=${ultraExtra.hits}/${ultraExtra.total} • risky blanket blocks=0/${RISKY_EXCLUSIONS.size}`);
} finally {
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
}
