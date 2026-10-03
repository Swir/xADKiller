package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;

import org.junit.Test;

/**
 * Large-list/ANR qualification for the v1.6 development track.
 *
 * The 750k parser exercise now streams its synthetic input instead of building a giant String
 * fixture first. That mirrors the production BufferedReader path and allows the same parser to be
 * re-run by CI under a deliberately constrained test-worker heap.
 */
public class BlocklistLargeListQualificationTest {
    private static final int PRODUCTION_DOMAIN_CEILING = 750_000;
    private static final long CI_PARSE_BUDGET_MS = 30_000L;
    private static final long MIB = 1024L * 1024L;
    private static final long COLLECTOR_ARRAY_PEAK_BUDGET_BYTES = 14L * MIB;
    private static final long QUALIFICATION_HEAP_LIMIT_BYTES = 128L * MIB;
    private static final String QUALIFICATION_PROPERTY = "xadkiller.largeListQualification";

    @Test public void productionParserQualifiesFull750kDomainCeiling() throws Exception {
        long collectorPeak = estimateCollectorArrayPeakFromProductionSource(PRODUCTION_DOMAIN_CEILING);
        assertTrue(String.format(Locale.ROOT,
                        "collector array peak exceeds %d MiB budget: %.2f MiB",
                        COLLECTOR_ARRAY_PEAK_BUDGET_BYTES / MIB, collectorPeak / (double)MIB),
                collectorPeak <= COLLECTOR_ARRAY_PEAK_BUDGET_BYTES);

        if (Boolean.getBoolean(QUALIFICATION_PROPERTY)) {
            long runtimeMax = Runtime.getRuntime().maxMemory();
            assertTrue(String.format(Locale.ROOT,
                            "bounded-memory qualification must run at <= %d MiB max heap, got %.2f MiB",
                            QUALIFICATION_HEAP_LIMIT_BYTES / MIB, runtimeMax / (double)MIB),
                    runtimeMax <= QUALIFICATION_HEAP_LIMIT_BYTES);
        }

        long started = System.nanoTime();
        int unique;
        try (InputStream input = new SyntheticDomainInputStream(PRODUCTION_DOMAIN_CEILING)) {
            unique = BlocklistManager.countUniqueNormalized(input, PRODUCTION_DOMAIN_CEILING);
        }
        long elapsedMs = (System.nanoTime() - started) / 1_000_000L;

        assertEquals("production parser must retain the full configured unique-domain ceiling",
                PRODUCTION_DOMAIN_CEILING, unique);
        assertTrue(String.format(Locale.ROOT,
                        "750k parser qualification exceeded %d ms: %d ms",
                        CI_PARSE_BUDGET_MS, elapsedMs),
                elapsedMs < CI_PARSE_BUDGET_MS);

        System.out.printf(Locale.ROOT,
                "[xADKiller Android large-list] unique=%d parse_ms=%d budget_ms=%d max_heap_mib=%.2f collector_array_peak_mib=%.2f constrained=%s%n",
                unique, elapsedMs, CI_PARSE_BUDGET_MS,
                Runtime.getRuntime().maxMemory() / (double)MIB,
                collectorPeak / (double)MIB,
                Boolean.getBoolean(QUALIFICATION_PROPERTY));
    }

    @Test public void collectorArrayPeakBoundMatchesProductionGrowthPolicy() throws Exception {
        long peak = estimateCollectorArrayPeakFromProductionSource(PRODUCTION_DOMAIN_CEILING);
        assertTrue("750k LongCollector array peak must stay below 14 MiB",
                peak <= COLLECTOR_ARRAY_PEAK_BUDGET_BYTES);
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

    private static long estimateCollectorArrayPeakFromProductionSource(int maxAccepted) throws Exception {
        String source = new String(
                Files.readAllBytes(findBlocklistManagerSource().toPath()), StandardCharsets.UTF_8);
        assertTrue("LongCollector initial-capacity policy changed; update memory proof",
                source.contains("LongCollector(int initial) { data = new long[Math.max(16, initial)]; }"));
        assertTrue("LongCollector growth policy changed; update memory proof",
                source.contains("data = Arrays.copyOf(data, data.length + (data.length >> 1) + 1024);"));
        assertTrue("LongCollector final-compaction policy changed; update memory proof",
                source.contains("return Arrays.copyOf(data, w);"));
        assertTrue("countUniqueNormalized initial-capacity policy changed; update memory proof",
                source.contains("new LongCollector(Math.min(32_768, Math.max(16, max)))"));

        int capacity = Math.min(32_768, Math.max(16, maxAccepted));
        long peakLongs = capacity;
        while (capacity < maxAccepted) {
            int next = capacity + (capacity >> 1) + 1024;
            peakLongs = Math.max(peakLongs, (long)capacity + next);
            capacity = next;
        }
        peakLongs = Math.max(peakLongs, (long)capacity + maxAccepted);
        return peakLongs * Long.BYTES;
    }

    private static File findServiceSource() {
        File direct = new File("src/main/java/com/swir/xadkiller/AdBlockVpnServiceV121.java");
        if (direct.isFile()) return direct;
        File fromRoot = new File("app/src/main/java/com/swir/xadkiller/AdBlockVpnServiceV121.java");
        if (fromRoot.isFile()) return fromRoot;
        throw new AssertionError("AdBlockVpnServiceV121.java not found from "
                + new File(".").getAbsolutePath());
    }

    private static File findBlocklistManagerSource() {
        File direct = new File("src/main/java/com/swir/xadkiller/BlocklistManager.java");
        if (direct.isFile()) return direct;
        File fromRoot = new File("app/src/main/java/com/swir/xadkiller/BlocklistManager.java");
        if (fromRoot.isFile()) return fromRoot;
        throw new AssertionError("BlocklistManager.java not found from "
                + new File(".").getAbsolutePath());
    }

    private static final class SyntheticDomainInputStream extends InputStream {
        private static final byte[] SUFFIX = ".large-list.invalid\n".getBytes(StandardCharsets.US_ASCII);
        private final int count;
        private final byte[] line = new byte[64];
        private int nextIndex;
        private int lineOffset;
        private int lineLength;

        SyntheticDomainInputStream(int count) {
            this.count = Math.max(0, count);
        }

        @Override public int read() throws IOException {
            if (lineOffset >= lineLength && !prepareLine()) return -1;
            return line[lineOffset++] & 0xff;
        }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (buffer == null) throw new NullPointerException("buffer");
            if (offset < 0 || length < 0 || length > buffer.length - offset) {
                throw new IndexOutOfBoundsException();
            }
            if (length == 0) return 0;

            int written = 0;
            while (written < length) {
                if (lineOffset >= lineLength && !prepareLine()) break;
                int copy = Math.min(length - written, lineLength - lineOffset);
                System.arraycopy(line, lineOffset, buffer, offset + written, copy);
                lineOffset += copy;
                written += copy;
            }
            return written == 0 ? -1 : written;
        }

        private boolean prepareLine() {
            if (nextIndex >= count) return false;
            int p = 0;
            line[p++] = (byte)'d';
            int value = nextIndex++;
            if (value == 0) {
                line[p++] = (byte)'0';
            } else {
                int divisor = 1;
                while (value / divisor >= 10) divisor *= 10;
                while (divisor > 0) {
                    line[p++] = (byte)('0' + ((value / divisor) % 10));
                    divisor /= 10;
                }
            }
            System.arraycopy(SUFFIX, 0, line, p, SUFFIX.length);
            lineLength = p + SUFFIX.length;
            lineOffset = 0;
            return true;
        }
    }
}
