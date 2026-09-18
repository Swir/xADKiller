import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STANDARD_HOSTS = [
  "liftoff.io",
  "advertising-api-eu.amazon.com",
  "fls-na.amazon.com",
  "ironsource.mobi",
  "indexexchange.com",
  "partnerads.ysm.yahoo.com",
  "bat.bing.com",
  "appmetrica.yandex.ru",
  "claritybt.freshmarketer.com",
  "fwtracks.freshmarketer.com",
  "quantcast.com",
  "cloudflareinsights.com",
  "posthog.com",
  "rudderstack.com",
  "rudderlabs.com",
  "prod.uidapi.com",
  "lr-ingest.com",
  "tr.facebook.com",
  "analytics.x.com",
  "ads.x.com",
  "pixel.quora.com",
  "qevents.quora.com",
  "px.srvcs.tumblr.com",
  "ads.vk.com",
  "log.byteoversea.com",
  "advertising.apple.com",
  "metrics2.data.hicloud.com",
  "logservice1.hicloud.com",
  "logbak.hicloud.com",
  "smartclip.com",
  "tracking.rus.miui.com",
  "settings-win.data.microsoft.com",
  "vortex.data.microsoft.com",
  "vortex-win.data.microsoft.com",
  "browser.events.data.msn.com",
  "mads-eu.amazon.com",
  "anrdoezrs.net",
  "dpbolvw.net",
  "tkqlhce.com",
  "shareasale.com",
  "awin1.com",
  "zenaps.com",
  "linksynergy.com",
  "redirectingat.com",
  "viglink.com",
  "refersion.com",
  "munchkin.marketo.net",
  "click.mailchimp.com",
  "sdk.iad-01.braze.com",
  "cdn.onesignal.com",
  "api.onesignal.com",
  "static.klaviyo.com",
  "a.klaviyo.com",
  "dai.google.com",
  "fwmrm.net",
  "xp.apple.com"
];
const ULTRA_ONLY_HOSTS = [
  "tagmanager.google.com",
  "fingerprints.com",
  "widgets.pinterest.com",
  "graph.instagram.com",
  "i.instagram.com",
  "cdn.cookielaw.org",
  "geolocation.onetrust.com",
  "privacyportal.onetrust.com",
  "consent.cookiebot.com",
  "consentcdn.cookiebot.com",
  "cookiebot.com",
  "consent.trustarc.com",
  "sdk.privacy-center.org",
  "cdn.privacy-mgmt.com",
  "app.usercentrics.eu",
  "cmp.osano.com",
  "fundingchoicesmessages.google.com",
  "widget.intercom.io",
  "js.driftt.com"
];

// Deliberately NOT forced by this fixture: s.youtube.com, redirector.googlevideo.com,
// g.jwpsrv.com, ssl.p.jwpcdn.com, grs.hicloud.com, c.bing.com, LaunchDarkly
// and fraud/checkout infrastructure such as Sift. Chasing those benchmark rows with
// blanket domain blocks can break playback, routing, feature flags or payments.

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

  console.log(`[xADKiller SCREEN] PASS • STANDARD=${standard.hits}/${standard.total} • ULTRA-core=${ultraCore.hits}/${ultraCore.total} • ULTRA-extra=${ultraExtra.hits}/${ultraExtra.total}`);
} finally {
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
}
