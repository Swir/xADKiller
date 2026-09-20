package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import org.junit.Test;

public class LogStoreTest {
    private static void append(StringBuilder out, long time, int uid, String domain) {
        out.append(time).append('\t').append(uid).append("\tApp\tcom.example.app\t")
                .append(domain).append("\tDNS blocklist\n");
    }

    @Test public void recentReadKeepsOnlyRequestedTailNewestFirst() throws Exception {
        File file = Files.createTempFile("xad-log-tail", ".log").toFile();
        StringBuilder body = new StringBuilder();
        for (int i = 1; i <= 10; i++) append(body, i, 1000 + i, "ads" + i + ".example.net");
        Files.write(file.toPath(), body.toString().getBytes(StandardCharsets.UTF_8));

        List<LogStore.Entry> recent = LogStore.readRecentFile(file, 3);
        assertEquals(3, recent.size());
        assertEquals("ads10.example.net", recent.get(0).domain);
        assertEquals("ads9.example.net", recent.get(1).domain);
        assertEquals("ads8.example.net", recent.get(2).domain);
    }

    @Test public void malformedHistoryDoesNotDisplaceValidTail() throws Exception {
        File file = Files.createTempFile("xad-log-malformed", ".log").toFile();
        StringBuilder body = new StringBuilder();
        append(body, 1, 1001, "first.example.net");
        body.append("broken line\n");
        body.append("not-a-time\t1002\tApp\tpkg\tbroken.example\treason\n");
        append(body, 2, 1002, "second.example.net");
        append(body, 3, 1003, "third.example.net");
        Files.write(file.toPath(), body.toString().getBytes(StandardCharsets.UTF_8));

        List<LogStore.Entry> recent = LogStore.readRecentFile(file, 2);
        assertEquals(2, recent.size());
        assertEquals("third.example.net", recent.get(0).domain);
        assertEquals("second.example.net", recent.get(1).domain);
    }

    @Test public void zeroLimitStillReturnsAtMostNewestSingleEntry() throws Exception {
        File file = Files.createTempFile("xad-log-zero", ".log").toFile();
        StringBuilder body = new StringBuilder();
        append(body, 1, 1001, "old.example.net");
        append(body, 2, 1002, "new.example.net");
        Files.write(file.toPath(), body.toString().getBytes(StandardCharsets.UTF_8));

        List<LogStore.Entry> recent = LogStore.readRecentFile(file, 0);
        assertEquals(1, recent.size());
        assertEquals("new.example.net", recent.get(0).domain);
    }

    @Test public void largeHistoryReadRemainsLogicallyBounded() throws Exception {
        File file = Files.createTempFile("xad-log-large", ".log").toFile();
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < 20_000; i++) append(body, i + 1L, 2000 + (i % 100), "ads" + i + ".example.net");
        Files.write(file.toPath(), body.toString().getBytes(StandardCharsets.UTF_8));

        List<LogStore.Entry> recent = LogStore.readRecentFile(file, 25);
        assertEquals(25, recent.size());
        assertEquals("ads19999.example.net", recent.get(0).domain);
        assertEquals("ads19975.example.net", recent.get(24).domain);
        assertTrue(file.length() > 1024 * 1024);
    }
}
