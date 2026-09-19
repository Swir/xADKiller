package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;

import org.junit.Test;

/**
 * Large-list/ANR qualification for the v1.6 development track.
 *
 * This is intentionally separate from blocking-effectiveness coverage: it verifies that the
 * production parser can consume the configured 750k-domain ceiling within a very generous CI
 * latency budget and that full-cache parsing stays on worker threads in the VPN service.
 */
public class BlocklistLargeListQualificationTest {
    private static final int PRODUCTION_DOMAIN_CEILING = 750_000;
    private static final long CI_PARSE_BUDGET_MS = 30_000L;

    @Test public void productionParserQualifiesFull750kDomainCeiling() throws Exception {
        StringBuilder payload = new StringBuilder(20 * 1024 * 1024);
        for (int i = 0; i < PRODUCTION_DOMAIN_CEILING; i++) {
            payload.append('d').append(i).append(".large-list.invalid\n");
        }
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);

        long started = System.nanoTime();
        int unique = BlocklistManager.countUniqueNormalized(
                new ByteArrayInputStream(bytes), PRODUCTION_DOMAIN_CEILING);
        long elapsedMs = (System.nanoTime() - started) / 1_000_000L;

        assertEquals("production parser must retain the full configured unique-domain ceiling",
                PRODUCTION_DOMAIN_CEILING, unique);
        assertTrue(String.format(Locale.ROOT,
                        "750k parser qualification exceeded %d ms: %d ms",
                        CI_PARSE_BUDGET_MS, elapsedMs),
                elapsedMs < CI_PARSE_BUDGET_MS);

        System.out.printf(Locale.ROOT,
                "[xADKiller Android large-list] unique=%d bytes=%d parse_ms=%d budget_ms=%d%n",
                unique, bytes.length, elapsedMs, CI_PARSE_BUDGET_MS);
    }

    @Test public void fullCacheLoadsRemainOffAndroidMainThreadByConstruction() throws Exception {
        String source = new String(
                Files.readAllBytes(findServiceSource().toPath()), StandardCharsets.UTF_8);

        int reloadAction = source.indexOf("if (ACTION_RELOAD.equals(action))");
        int reloadThread = source.indexOf("new Thread(() -> {", reloadAction);
        int reloadLoad = source.indexOf("BlocklistManager.load(getApplicationContext())", reloadThread);
        int reloadReturn = source.indexOf("return workerRunning.get()", reloadAction);
        assertTrue("ACTION_RELOAD must parse the full cache inside its worker thread",
                reloadAction >= 0 && reloadThread > reloadAction && reloadLoad > reloadThread
                        && reloadReturn > reloadLoad);

        int pipeline = source.indexOf("private void startProtectionPipeline()");
        int workerThread = source.indexOf("worker = new Thread(() -> {", pipeline);
        int pipelineLoad = source.indexOf("BlocklistManager.load(getApplicationContext())", workerThread);
        int workerStart = source.indexOf("worker.start();", workerThread);
        assertTrue("VPN startup must parse the full cache inside xADKiller-VPN-Worker",
                pipeline >= 0 && workerThread > pipeline && pipelineLoad > workerThread
                        && workerStart > pipelineLoad);
    }

    private static File findServiceSource() {
        File direct = new File("src/main/java/com/swir/xadkiller/AdBlockVpnServiceV121.java");
        if (direct.isFile()) return direct;
        File fromRoot = new File("app/src/main/java/com/swir/xadkiller/AdBlockVpnServiceV121.java");
        if (fromRoot.isFile()) return fromRoot;
        throw new AssertionError("AdBlockVpnServiceV121.java not found from "
                + new File(".").getAbsolutePath());
    }
}
