package com.swir.xadkiller;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class BlocklistManager {
    static final String PREFS = "xadkiller_prefs";
    static final String KEY_CUSTOM_BLOCK = "custom_block";
    static final String KEY_ALLOW = "allow_list";
    static final String KEY_AUTOSTART = "auto_start";
    static final String KEY_LAST_UPDATE = "last_update";
    static final String KEY_STRICT = "strict_mode";

    private static final String[] NORMAL_URLS = {
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
            "https://adaway.org/hosts.txt"
    };
    private static final String PRO_URL = "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists-legacy@latest/domains/pro.txt";
    private static final String CACHE_FILE = "remote_blocklist.txt";
    private static final int MAX_REMOTE_DOMAINS = 500_000;

    /*
     * v1.2.1: Instead of keeping hundreds of thousands of Java Strings in a
     * HashSet, we keep sorted 64-bit hashes. 500k entries use ~4 MB for the
     * final array and lookups are O(log n). This prevents the PRO list from
     * exhausting the app heap on phones with aggressive memory management.
     */
    private static volatile long[] BLOCKED = new long[0];
    private static volatile Set<String> ALLOWED = Collections.emptySet();
    private static volatile boolean fullLoaded;

    private BlocklistManager() {}

    /** Fast startup: bundled list + user rules only. Safe to call on UI thread. */
    static synchronized int bootstrap(Context context) {
        try {
            LongCollector c = new LongCollector(8192);
            try (InputStream in = context.getAssets().open("default_blocklist.txt")) {
                parseDomainStream(in, c, 80_000);
            } catch (IOException ignored) {}
            addCustomRules(context, c);
            BLOCKED = c.toSortedUnique();
            ALLOWED = readAllowList(context);
            fullLoaded = false;
            return BLOCKED.length;
        } catch (Throwable t) {
            BLOCKED = new long[0];
            ALLOWED = Collections.emptySet();
            fullLoaded = false;
            return 0;
        }
    }

    /** Full load including downloaded cache. Call from a worker thread. */
    static synchronized int load(Context context) {
        try {
            LongCollector c = new LongCollector(32_768);
            try (InputStream in = context.getAssets().open("default_blocklist.txt")) {
                parseDomainStream(in, c, 80_000);
            } catch (IOException ignored) {}

            File cache = new File(context.getFilesDir(), CACHE_FILE);
            if (cache.isFile()) {
                try (InputStream in = new FileInputStream(cache)) {
                    parseDomainStream(in, c, MAX_REMOTE_DOMAINS);
                } catch (IOException ignored) {}
            }
            addCustomRules(context, c);
            long[] result = c.toSortedUnique();
            Set<String> allow = readAllowList(context);
            BLOCKED = result;
            ALLOWED = allow;
            fullLoaded = true;
            return result.length;
        } catch (OutOfMemoryError oom) {
            // Keep the previously working/bootstrap list instead of crash-looping.
            fullLoaded = false;
            try { SystemLogStore.error(context, "BLOCKLIST", "Brak pamięci podczas ładowania pełnej listy — pozostaje lista awaryjna", oom); } catch (Throwable ignored) {}
            return BLOCKED.length;
        } catch (Throwable t) {
            fullLoaded = false;
            try { SystemLogStore.error(context, "BLOCKLIST", "Błąd ładowania pełnej listy — pozostaje lista awaryjna", t); } catch (Throwable ignored) {}
            return BLOCKED.length;
        }
    }

    static boolean isFullLoaded() { return fullLoaded; }

    static boolean isBlocked(String domain) {
        String d = normalize(domain);
        if (d == null) return false;

        Set<String> allow = ALLOWED;
        String current = d;
        while (true) {
            if (allow.contains(current)) return false;
            int dot = current.indexOf('.');
            if (dot < 0) break;
            current = current.substring(dot + 1);
        }

        long[] block = BLOCKED;
        current = d;
        while (true) {
            if (Arrays.binarySearch(block, hash64(current)) >= 0) return true;
            int dot = current.indexOf('.');
            if (dot < 0) return false;
            current = current.substring(dot + 1);
        }
    }

    static int currentCount() { return BLOCKED.length; }

    /** Downloads lists without building a huge String HashSet in RAM. */
    static synchronized int updateRemote(Context context) throws IOException {
        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        File dst = new File(context.getFilesDir(), CACHE_FILE);
        int written = 0;

        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8), 64 * 1024)) {
            for (String url : NORMAL_URLS) {
                if (written >= MAX_REMOTE_DOMAINS) break;
                written += downloadInto(url, writer, MAX_REMOTE_DOMAINS - written);
            }
            boolean pro = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_STRICT, false);
            if (pro && written < MAX_REMOTE_DOMAINS) {
                written += downloadInto(PRO_URL, writer, MAX_REMOTE_DOMAINS - written);
            }
        } catch (Throwable t) {
            // Do not replace a known-good cache with a partial download.
            tmp.delete();
            if (t instanceof IOException) throw (IOException)t;
            throw new IOException("Błąd pobierania list: " + t.getClass().getSimpleName(), t);
        }

        if (written < 1000) {
            tmp.delete();
            throw new IOException("Lista wygląda na niepełną: " + written);
        }
        if (dst.exists() && !dst.delete()) {
            tmp.delete();
            throw new IOException("Nie można podmienić starej listy");
        }
        if (!tmp.renameTo(dst)) {
            tmp.delete();
            throw new IOException("Nie można zapisać listy");
        }

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(KEY_LAST_UPDATE, System.currentTimeMillis()).apply();
        return load(context);
    }

    static synchronized void clearRemoteCache(Context context) {
        File cache = new File(context.getFilesDir(), CACHE_FILE);
        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        if (cache.exists()) cache.delete();
        if (tmp.exists()) tmp.delete();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_LAST_UPDATE).putBoolean(KEY_STRICT, false).apply();
        bootstrap(context);
    }

    static void addCustomBlock(Context context, String domain) {
        updateSet(context, KEY_CUSTOM_BLOCK, domain, true);
        updateSet(context, KEY_ALLOW, domain, false);
        String n = normalize(domain);
        if (n != null) addHashToCurrent(hash64(n));
        ALLOWED = readAllowList(context);
    }

    static void addAllow(Context context, String domain) {
        updateSet(context, KEY_ALLOW, domain, true);
        updateSet(context, KEY_CUSTOM_BLOCK, domain, false);
        ALLOWED = readAllowList(context);
    }

    static void clearCustomRules(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_CUSTOM_BLOCK).remove(KEY_ALLOW).apply();
        ALLOWED = Collections.emptySet();
        // Full reload is intentionally not performed here on the caller/UI thread.
    }

    private static int downloadInto(String source, BufferedWriter writer, int max) throws IOException {
        if (max <= 0) return 0;
        HttpURLConnection conn = (HttpURLConnection) new URL(source).openConnection();
        conn.setConnectTimeout(12_000);
        conn.setReadTimeout(35_000);
        conn.setRequestProperty("User-Agent", "xADKiller/1.2.1");
        conn.setInstanceFollowRedirects(true);
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
            conn.disconnect();
            throw new IOException("HTTP " + code + " z " + source);
        }
        int count = 0;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8), 64 * 1024)) {
            String line;
            while (count < max && (line = reader.readLine()) != null) {
                String n = normalizeLine(line);
                if (n == null) continue;
                writer.write(n);
                writer.newLine();
                count++;
            }
        } finally {
            conn.disconnect();
        }
        return count;
    }

    private static void parseDomainStream(InputStream input, LongCollector out, int max) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8), 64 * 1024)) {
            String line;
            int accepted = 0;
            while (accepted < max && (line = reader.readLine()) != null) {
                String n = normalizeLine(line);
                if (n == null) continue;
                out.add(hash64(n));
                accepted++;
            }
        }
    }

    private static String normalizeLine(String line) {
        if (line == null) return null;
        line = line.trim();
        if (line.isEmpty() || line.charAt(0) == '#') return null;
        int hash = line.indexOf('#');
        if (hash >= 0) line = line.substring(0, hash).trim();
        if (line.isEmpty()) return null;

        int firstWs = firstWhitespace(line);
        String first = firstWs < 0 ? line : line.substring(0, firstWs);
        String candidate = first;
        if (firstWs >= 0 && looksLikeIp(first)) {
            int p = firstWs;
            while (p < line.length() && Character.isWhitespace(line.charAt(p))) p++;
            if (p >= line.length()) return null;
            int end = p;
            while (end < line.length() && !Character.isWhitespace(line.charAt(end))) end++;
            candidate = line.substring(p, end);
        }
        return normalize(candidate);
    }

    private static int firstWhitespace(String s) {
        for (int i = 0; i < s.length(); i++) if (Character.isWhitespace(s.charAt(i))) return i;
        return -1;
    }

    private static boolean looksLikeIp(String s) {
        if (s.indexOf(':') >= 0) return true;
        boolean dot = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '.') { dot = true; continue; }
            if (c < '0' || c > '9') return false;
        }
        return dot;
    }

    private static void addCustomRules(Context context, LongCollector c) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> custom = prefs.getStringSet(KEY_CUSTOM_BLOCK, Collections.emptySet());
        if (custom != null) for (String d : custom) {
            String n = normalize(d);
            if (n != null) c.add(hash64(n));
        }
    }

    private static Set<String> readAllowList(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> allow = prefs.getStringSet(KEY_ALLOW, Collections.emptySet());
        if (allow == null || allow.isEmpty()) return Collections.emptySet();
        HashSet<String> out = new HashSet<>();
        for (String d : allow) {
            String n = normalize(d);
            if (n != null) out.add(n);
        }
        return Collections.unmodifiableSet(out);
    }

    private static void updateSet(Context context, String key, String domain, boolean add) {
        String n = normalize(domain);
        if (n == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        HashSet<String> copy = new HashSet<>();
        Set<String> old = prefs.getStringSet(key, Collections.emptySet());
        if (old != null) copy.addAll(old);
        if (add) copy.add(n); else copy.remove(n);
        prefs.edit().putStringSet(key, copy).apply();
    }

    private static synchronized void addHashToCurrent(long hash) {
        long[] old = BLOCKED;
        int idx = Arrays.binarySearch(old, hash);
        if (idx >= 0) return;
        int insert = -idx - 1;
        long[] n = new long[old.length + 1];
        System.arraycopy(old, 0, n, 0, insert);
        n[insert] = hash;
        System.arraycopy(old, insert, n, insert + 1, old.length - insert);
        BLOCKED = n;
    }

    static String normalize(String domain) {
        if (domain == null) return null;
        String d = domain.trim().toLowerCase(Locale.ROOT);
        if (d.startsWith("http://") || d.startsWith("https://")) {
            try { d = new URL(d).getHost().toLowerCase(Locale.ROOT); }
            catch (Exception e) { return null; }
        }
        while (d.startsWith("*.")) d = d.substring(2);
        while (d.endsWith(".")) d = d.substring(0, d.length() - 1);
        if (d.isEmpty() || d.length() > 253 || d.equals("localhost") || d.equals("localhost.localdomain") || d.equals("broadcasthost")) return null;
        if (!d.contains(".")) return null;
        for (int i = 0; i < d.length(); i++) {
            char c = d.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
            if (!ok) return null;
        }
        return d;
    }

    private static long hash64(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x100000001b3L;
        }
        return h;
    }

    private static final class LongCollector {
        private long[] data;
        private int size;

        LongCollector(int initial) { data = new long[Math.max(16, initial)]; }
        void add(long v) {
            if (size == data.length) data = Arrays.copyOf(data, data.length + (data.length >> 1) + 1024);
            data[size++] = v;
        }
        long[] toSortedUnique() {
            if (size == 0) return new long[0];
            Arrays.sort(data, 0, size);
            int w = 1;
            for (int r = 1; r < size; r++) if (data[r] != data[w - 1]) data[w++] = data[r];
            return Arrays.copyOf(data, w);
        }
    }
}
