package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class BlocklistCoverageTest {
    private static final String[] AD_FIXTURES = {
            "pagead2.googlesyndication.com", "tpc.googlesyndication.com", "googleadservices.com",
            "stats.g.doubleclick.net", "securepubads.g.doubleclick.net", "adservice.google.com",
            "google-analytics.com", "www.google-analytics.com", "app-measurement.com",
            "sb.scorecardresearch.com", "pixel.quantserve.com", "ib.adnxs.com", "secure.adnxs.com",
            "match.adsrvr.org", "insight.adsrvr.org", "static.criteo.net", "bidder.criteo.com",
            "fastlane.rubiconproject.com", "eus.rubiconproject.com", "us-u.openx.net",
            "ads.pubmatic.com", "image2.pubmatic.com", "as.casalemedia.com", "z.moatads.com",
            "aax.amazon-adsystem.com", "c.amazon-adsystem.com", "cdn.taboola.com", "trc.taboola.com",
            "widgets.outbrain.com", "odb.outbrain.com", "prg.smartadserver.com", "diff.smartadserver.com",
            "track.adform.net", "s1.adform.net", "htlb.casalemedia.com", "as-sec.casalemedia.com",
            "js-sec.indexww.com", "btlr.sharethrough.com", "ads.yieldmo.com", "ads.media.net",
            "bh.contextweb.com", "x.bidswitch.net", "eb2.3lift.com", "tlx.3lift.com",
            "tlx.3lift.com", "eb2.3lift.com", "cdn.lijit.com", "ads.gumgum.com", "a.teads.tv",
            "bs.serving-sys.com", "fast.demdex.net", "cm.everesttech.net", "tags.bluekai.com",
            "pixel.mathtag.com", "d.adroll.com", "s.adroll.com", "api2.branch.io", "app.adjust.com",
            "t.appsflyer.com", "control.kochava.com", "sdk-api-v1.singular.net",
            "ads.unity3d.com", "config.unityads.unity3d.com", "ads.api.vungle.com", "a.applovin.com",
            "ms.applovin.com", "live.chartboost.com", "ws.tapjoyads.com", "telemetry.sdk.inmobi.com",
            "init.startappservice.com", "ads.flurry.com", "adc3-launch.adcolony.com",
            "logs.ironsrc.com", "outcome-ssp.supersonicads.com", "sdk.mintegral.com",
            "cdn.fyber.com", "ads.mopub.com", "api.pubnative.net", "soma.smaato.net",
            "script.hotjar.com", "cdn.mouseflow.com", "cdn.luckyorange.com", "edge.fullstory.com",
            "cdn.logrocket.com", "api.segment.io", "api.mixpanel.com", "api2.amplitude.com",
            "c1.zedo.com", "serve.popads.net", "go.propellerads.com", "main.exoclick.com",
            "ads.trafficjunky.com", "adserver.juicyads.com", "hilltopads.net", "adsterra.com",
            "clickadu.com",

            // High-confidence misses collected during the user's 2026-09-18 manual Chrome test.
            // They are useful cross-platform DNS fixtures too; deliberately risky consent,
            // playback, feature-flag and checkout/fraud endpoints are not promoted here.
            "api.liftoff.io", "ironsource.mobi", "cdn.indexexchange.com",
            "udc.yahoo.com", "udcm.yahoo.com", "partnerads.ysm.yahoo.com", "log.fc.yahoo.com",
            "bat.bing.com", "ads.microsoft.com", "appmetrica.yandex.ru",
            "claritybt.freshmarketer.com", "fwtracks.freshmarketer.com", "quantcast.com",
            "cloudflareinsights.com", "app.posthog.com", "cdn.rudderstack.com",
            "cdn.rudderlabs.com", "prod.uidapi.com", "cdn.lr-ingest.com", "tr.facebook.com",
            "analytics.x.com", "ads.x.com", "pixel.quora.com", "qevents.quora.com",
            "px.srvcs.tumblr.com", "ads.vk.com", "log.byteoversea.com", "smartclip.com",
            "mads-eu.amazon.com", "mssl.fwmrm.net", "api.fingerprintjs.com"
    };

    private static final String[] BENIGN_FIXTURES = {
            "example.com", "www.wikipedia.org", "developer.mozilla.org", "github.com",
            "raw.githubusercontent.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.gstatic.com",
            "www.python.org", "openjdk.org", "kernel.org", "debian.org", "ubuntu.com", "mozilla.org",
            "chromium.org", "stackoverflow.com", "npmjs.com", "pypi.org", "gradle.org", "android.com"
    };

    @Test public void offlineStarterListHasCompleteSyntheticCoverageAndNoControlHits() throws Exception {
        Set<String> domains = readStarterDomains();
        assertTrue("starter list unexpectedly small: " + domains.size(), domains.size() >= 120);

        int hits = 0;
        for (String host : AD_FIXTURES) if (covered(host, domains)) hits++;
        int falsePositives = 0;
        for (String host : BENIGN_FIXTURES) if (covered(host, domains)) falsePositives++;

        double coverage = 100.0d * hits / AD_FIXTURES.length;
        System.out.printf(Locale.ROOT,
                "[xADKiller Android benchmark] offline DNS fixture coverage=%.1f%% (%d/%d), benign false positives=%d/%d, starter domains=%d%n",
                coverage, hits, AD_FIXTURES.length, falsePositives, BENIGN_FIXTURES.length, domains.size());

        assertEquals("offline DNS fixture suite must stay fully covered", AD_FIXTURES.length, hits);
        assertEquals("benign control domain was covered by starter list", 0, falsePositives);
    }

    @Test public void starterListIsNormalizedAndDuplicateFree() throws Exception {
        File asset = findAsset();
        List<String> lines = Files.readAllLines(asset.toPath(), StandardCharsets.UTF_8);
        Set<String> seen = new HashSet<>();
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            assertEquals("starter domain must be lowercase", line.toLowerCase(Locale.ROOT), line);
            assertNotNull("starter domain must be accepted by production normalizer: " + line,
                    BlocklistManager.normalize(line));
            assertTrue("duplicate starter domain: " + line, seen.add(line));
        }
    }

    private static Set<String> readStarterDomains() throws Exception {
        List<String> lines = Files.readAllLines(findAsset().toPath(), StandardCharsets.UTF_8);
        Set<String> domains = new HashSet<>();
        for (String raw : lines) {
            String line = raw.trim().toLowerCase(Locale.ROOT);
            if (!line.isEmpty() && !line.startsWith("#")) domains.add(line);
        }
        return domains;
    }

    private static File findAsset() {
        File direct = new File("src/main/assets/default_blocklist.txt");
        if (direct.isFile()) return direct;
        File fromRoot = new File("app/src/main/assets/default_blocklist.txt");
        if (fromRoot.isFile()) return fromRoot;
        throw new AssertionError("default_blocklist.txt not found from " + new File(".").getAbsolutePath());
    }

    private static boolean covered(String rawHost, Set<String> domains) {
        String host = rawHost.toLowerCase(Locale.ROOT);
        while (true) {
            if (domains.contains(host)) return true;
            int dot = host.indexOf('.');
            if (dot < 0) return false;
            host = host.substring(dot + 1);
        }
    }
}
