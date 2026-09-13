package com.swir.xadkiller;

import android.content.Context;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class SystemLogStore {
    static final String PREF_VERBOSE_DNS = "verbose_dns_log";
    private static final String FILE_NAME = "system_console.log";
    private static final long MAX_BYTES = 2L * 1024L * 1024L;
    private static final int KEEP_AFTER_ROTATE = 450;

    static final class Entry {
        final long time;
        final String level;
        final String category;
        final String message;
        final String detail;

        Entry(long time, String level, String category, String message, String detail) {
            this.time = time;
            this.level = safe(level);
            this.category = safe(category);
            this.message = safe(message);
            this.detail = safe(detail);
        }
    }

    private SystemLogStore() {}

    static void info(Context c, String category, String message) { add(c, "INFO", category, message, ""); }
    static void warn(Context c, String category, String message) { add(c, "WARN", category, message, ""); }
    static void block(Context c, String category, String message, String detail) { add(c, "BLOCK", category, message, detail); }
    static void dns(Context c, String message, String detail) { add(c, "DNS", "DNS", message, detail); }

    static void error(Context c, String category, String message, Throwable t) {
        add(c, "ERROR", category, message, stackTrace(t));
    }

    static synchronized void add(Context context, String level, String category, String message, String detail) {
        if (context == null) return;
        try {
            File f = new File(context.getFilesDir(), FILE_NAME);
            if (f.exists() && f.length() > MAX_BYTES) rotate(context, f);
            try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f, true), StandardCharsets.UTF_8))) {
                w.write(System.currentTimeMillis() + "\t" + clean(level) + "\t" + clean(category) + "\t" + clean(message) + "\t" + clean(detail));
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
                if (p.length < 5) continue;
                try { all.add(new Entry(Long.parseLong(p[0]), p[1], p[2], p[3], p[4])); }
                catch (Exception ignored) {}
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

    static String stackTrace(Throwable t) {
        if (t == null) return "";
        try {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            String out = sw.toString();
            return out.length() > 12000 ? out.substring(0, 12000) : out;
        } catch (Exception e) { return t.toString(); }
    }

    private static void rotate(Context context, File f) {
        List<Entry> recent = readRecent(context, KEEP_AFTER_ROTATE);
        if (!f.delete()) return;
        Collections.reverse(recent);
        for (Entry e : recent) add(context, e.level, e.category, e.message, e.detail);
    }

    private static String clean(String s) {
        return safe(s).replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
    }
    private static String safe(String s) { return s == null ? "" : s; }
}
