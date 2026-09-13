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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class LogStore {
    private static final String FILE_NAME = "blocked.log";
    private static final long MAX_BYTES = 1024 * 1024;

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
        File f = new File(context.getFilesDir(), FILE_NAME);
        if (!f.isFile()) return Collections.emptyList();
        ArrayList<Entry> all = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = line.split("\\t", -1);
                if (p.length < 6) continue;
                try {
                    all.add(new Entry(Long.parseLong(p[0]), Integer.parseInt(p[1]), p[2], p[3], p[4], p[5]));
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        int from = Math.max(0, all.size() - Math.max(1, limit));
        ArrayList<Entry> out = new ArrayList<>(all.subList(from, all.size()));
        Collections.reverse(out);
        return out;
    }

    static synchronized void clear(Context context) {
        File f = new File(context.getFilesDir(), FILE_NAME);
        if (f.exists()) f.delete();
    }

    private static void rotate(Context context, File f) {
        List<Entry> recent = readRecent(context, 250);
        if (!f.delete()) return;
        Collections.reverse(recent);
        for (Entry e : recent) add(context, e);
    }

    private static String clean(String s) {
        return safe(s).replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
    }

    private static String safe(String s) { return s == null ? "" : s; }
}
