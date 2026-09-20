package com.swir.xadkiller;

import android.content.Context;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class LogStore {
    private static final String FILE_NAME = "blocked.log";
    private static final long MAX_BYTES = 1024 * 1024;
    private static final int MAX_READ_ENTRIES = 5_000;

    static final class Entry {
        final long time;
        final int uid;
        final String appName;
        final String packageName;
        final String domain;
        final String reason;

        Entry(long time, int uid, String appName, String packageName, String domain, String reason) {
            this.time = time;
            this.uid = uid;
            this.appName = safe(appName);
            this.packageName = safe(packageName);
            this.domain = safe(domain);
            this.reason = safe(reason);
        }
    }

    private LogStore() {}

    static synchronized void add(Context context, Entry e) {
        try {
            File f = new File(context.getFilesDir(), FILE_NAME);
            if (f.exists() && f.length() > MAX_BYTES) rotate(context, f);
            try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f, true), StandardCharsets.UTF_8))) {
                w.write(e.time + "\t" + e.uid + "\t" + clean(e.appName) + "\t" + clean(e.packageName) + "\t" + clean(e.domain) + "\t" + clean(e.reason));
                w.newLine();
            }
        } catch (Exception ignored) {}
    }

    static synchronized List<Entry> readRecent(Context context, int limit) {
        return readRecentFile(new File(context.getFilesDir(), FILE_NAME), limit);
    }

    /**
     * Reads only the newest bounded tail into memory while streaming the log once.
     * This prevents System Console / recovery reads from retaining the whole 1 MiB log
     * as Entry objects and also makes malformed historical lines harmless.
     */
    static List<Entry> readRecentFile(File file, int limit) {
        if (file == null || !file.isFile()) return Collections.emptyList();
        int wanted = Math.max(1, Math.min(limit, MAX_READ_ENTRIES));
        ArrayDeque<Entry> tail = new ArrayDeque<>(Math.min(wanted, 256));
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                Entry entry = parseLine(line);
                if (entry == null) continue;
                if (tail.size() == wanted) tail.removeFirst();
                tail.addLast(entry);
            }
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
        if (tail.isEmpty()) return Collections.emptyList();
        ArrayList<Entry> out = new ArrayList<>(tail);
        Collections.reverse(out);
        return out;
    }

    /** Returns the newest valid blocked domain without exposing history outside the app. */
    static synchronized String latestRecoverableDomain(Context context) {
        for (Entry entry : readRecent(context, 20)) {
            String normalized = BlocklistManager.normalize(entry.domain);
            if (normalized != null) return normalized;
        }
        return null;
    }

    /**
     * Local-only false-positive recovery primitive. It updates the existing allowlist;
     * no hostname, package name or browsing data is uploaded anywhere.
     */
    static synchronized boolean recoverLatestFalsePositive(Context context) {
        String domain = latestRecoverableDomain(context);
        if (domain == null) return false;
        BlocklistManager.addAllow(context, domain);
        SystemLogStore.info(context, "RECOVERY", "Allowed latest blocked domain from local log");
        return true;
    }

    static synchronized void clear(Context context) {
        File f = new File(context.getFilesDir(), FILE_NAME);
        if (f.exists()) f.delete();
    }

    private static void rotate(Context context, File f) {
        List<Entry> recent = readRecentFile(f, 250);
        if (!f.delete()) return;
        Collections.reverse(recent);
        for (Entry e : recent) add(context, e);
    }

    private static Entry parseLine(String line) {
        if (line == null || line.isEmpty()) return null;
        String[] p = line.split("\\t", -1);
        if (p.length < 6) return null;
        try {
            return new Entry(Long.parseLong(p[0]), Integer.parseInt(p[1]), p[2], p[3], p[4], p[5]);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String clean(String s) {
        return safe(s).replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
    }

    private static String safe(String s) { return s == null ? "" : s; }
}
