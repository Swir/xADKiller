import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller BENCH] ${stage}${extra ? ` • ${extra}` : ""}`);

// This is a deterministic regression benchmark, not a claim about every ad on
// the public web. Requests deliberately cover common ad-tech hosts plus
// first-party ad paths that domain-only blockers often miss.
const AD_CASES = [
  ["https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "script"],
  ["https://securepubads.g.doubleclick.net/tag/js/gpt.js", "script"],
  ["https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-test", "xmlhttprequest"],
  ["https://www.googleadservices.com/pagead/conversion.js", "script"],
  ["https://cdn.taboola.com/libtrc/publisher/loader.js", "script"],
  ["https://trc.taboola.com/log/3/redirect", "xmlhttprequest"],
  ["https://widgets.outbrain.com/outbrain.js", "script"],
  ["https://odb.outbrain.com/utils/get?widgetId=1", "xmlhttprequest"],
  ["https://ads.pubmatic.com/AdServer/js/pwt/123.js", "script"],
  ["https://fastlane.rubiconproject.com/a/api/fastlane.json", "xmlhttprequest"],
  ["https://ib.adnxs.com/ut/v3/prebid", "xmlhttprequest"],
  ["https://match.adsrvr.org/track/cmf/generic", "image"],
  ["https://static.criteo.net/js/ld/publishertag.js", "script"],
  ["https://ads.amazon-adsystem.com/aax2/apstag.js", "script"],
  ["https://ads.media.net/ads/ads.php", "script"],
  ["https://prg.smartadserver.com/ac?siteid=1", "xmlhttprequest"],
  ["https://track.adform.net/serving/scripts/trackpoint/", "script"],
  ["https://js-sec.indexww.com/ht/p/123.js", "script"],
  ["https://btlr.sharethrough.com/header-bid/v1", "xmlhttprequest"],
  ["https://ads.yieldmo.com/exchange/prebid", "xmlhttprequest"],
  ["https://x.bidswitch.net/sync", "image"],
  ["https://eb2.3lift.com/sync", "image"],
  ["https://ads.gumgum.com/usync", "image"],
  ["https://a.teads.tv/page/123/tag", "script"],
  ["https://bs.serving-sys.com/BurstingPipe/adServer.bs", "sub_frame"],
  ["https://fast.demdex.net/dest5.html", "sub_frame"],
  ["https://pixel.mathtag.com/sync/img", "image"],
  ["https://d.adroll.com/cm/index/out", "image"],
  ["https://ads.unity3d.com/video", "media"],
  ["https://ads.api.vungle.com/config", "xmlhttprequest"],
  ["https://a.applovin.com/4.0/ad", "xmlhttprequest"],
  ["https://live.chartboost.com/api/install", "xmlhttprequest"],
  ["https://ws.tapjoyads.com/connect", "xmlhttprequest"],
  ["https://telemetry.sdk.inmobi.com/metrics", "xmlhttprequest"],
  ["https://ads.flurry.com/v19/getAds.do", "xmlhttprequest"],
  ["https://ads.mopub.com/m/ad", "xmlhttprequest"],
  ["https://publisher.xad.test/ads/banner.js", "script"],
  ["https://publisher.xad.test/adserver/request", "xmlhttprequest"],
  ["https://publisher.xad.test/adservice/fetch", "xmlhttprequest"],
  ["https://publisher.xad.test/pagead/render", "sub_frame"],
  ["https://publisher.xad.test/gampad/ads", "xmlhttprequest"],
  ["https://publisher.xad.test/securepubads/slot.js", "script"],
  ["https://publisher.xad.test/prebid.js", "script"],
  ["https://publisher.xad.test/api/content?ad_unit=leaderboard", "xmlhttprequest"],
  ["https://publisher.xad.test/api/content?ad_slot=top", "xmlhttprequest"],
  ["https://publisher.xad.test/vast/preroll.xml", "xmlhttprequest"],
  ["https://publisher.xad.test/vmap/playlist.xml", "xmlhttprequest"],
  ["https://publisher.xad.test/ima3/sdk.js", "script"],
  ["https://publisher.xad.test/commercial/preroll.mp4", "media"]
];

const BENIGN_CASES = [
  ["https://example.com/assets/app.js", "script"],
  ["https://example.com/api/articles?id=42", "xmlhttprequest"],
  ["https://example.org/images/logo.png", "image"],
  ["https://cdn.jsdelivr.net/npm/react@19/umd/react.production.min.js", "script"],
  ["https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css", "stylesheet"],
  ["https://fonts.gstatic.com/s/roboto/v30/test.woff2", "font"],
  ["https://developer.mozilla.org/en-US/docs/Web/API/fetch", "main_frame"],
  ["https://www.wikipedia.org/portal/wikipedia.org/assets/img/sprite.svg", "image"],
  ["https://github.com/Swir/xADKiller", "main_frame"],
  ["https://raw.githubusercontent.com/Swir/xADKiller/main/README.md", "xmlhttprequest"],
  ["https://www.python.org/static/js/main-min.js", "script"],
  ["https://gradle.org/releases/", "main_frame"],
  ["https://www.android.com/intl/en_us/phones/", "main_frame"],
  ["https://kernel.org/theme/js/main.js", "script"]
];

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

async function matchCases(worker, cases) {
  return await worker.evaluate(async (rows) => {
    const out = [];
    for (const [url, type] of rows) {
      const result = await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        initiator: "https://publisher.xad.test",
        type
      });
      const matches = Array.isArray(result?.matchedRules) ? result.matchedRules : [];
      out.push({ url, type, matched: matches.length > 0, matches });
    }
    return out;
  }, cases);
}

function score(results) {
  const hits = results.filter((x) => x.matched).length;
  return { hits, total: results.length, pct: 100 * hits / results.length };
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

  const standardAds = await matchCases(worker, AD_CASES);
  const standardBenign = await matchCases(worker, BENIGN_CASES);
  const standard = score(standardAds);
  const standardFalse = standardBenign.filter((x) => x.matched);
  log("STANDARD", `${standard.pct.toFixed(1)}% (${standard.hits}/${standard.total}) • benign false matches=${standardFalse.length}/${BENIGN_CASES.length}`);

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: "domcontentloaded", timeout: 12000 });
  const modeResult = await popup.evaluate(async () => await chrome.runtime.sendMessage({ type: "setMode", mode: "ultra" }));
  if (!modeResult?.ok) throw new Error(`could not enable ULTRA: ${JSON.stringify(modeResult)}`);
  await delay(1800);

  const ultraAds = await matchCases(worker, AD_CASES);
  const ultraBenign = await matchCases(worker, BENIGN_CASES);
  const ultra = score(ultraAds);
  const ultraFalse = ultraBenign.filter((x) => x.matched);
  log("ULTRA", `${ultra.pct.toFixed(1)}% (${ultra.hits}/${ultra.total}) • benign false matches=${ultraFalse.length}/${BENIGN_CASES.length}`);

  const standardMisses = standardAds.filter((x) => !x.matched).map((x) => x.url);
  const ultraMisses = ultraAds.filter((x) => !x.matched).map((x) => x.url);
  if (standardMisses.length) log("STANDARD misses", standardMisses.join(" | "));
  if (ultraMisses.length) log("ULTRA misses", ultraMisses.join(" | "));
  if (standardFalse.length || ultraFalse.length) {
    log("Benign matches", [...new Set([...standardFalse, ...ultraFalse].map((x) => x.url))].join(" | "));
  }

  if (standard.pct < 80) throw new Error(`STANDARD synthetic coverage below 80%: ${standard.pct.toFixed(1)}%`);
  if (ultra.pct < 90) throw new Error(`ULTRA synthetic coverage below 90%: ${ultra.pct.toFixed(1)}%`);
  if (ultra.pct + 0.001 < standard.pct) throw new Error(`ULTRA regressed below STANDARD: ${ultra.pct.toFixed(1)} < ${standard.pct.toFixed(1)}`);
  if (standardFalse.length || ultraFalse.length) throw new Error("benign control request matched a blocking rule");

  log("PASS", `deterministic Chromium DNR benchmark • STANDARD=${standard.pct.toFixed(1)}% • ULTRA=${ultra.pct.toFixed(1)}% • benign=0/${BENIGN_CASES.length}`);
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
}
