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
    static final String KEY_CACHE_MODE = "remote_cache_mode_v160";

    private static final String[] NORMAL_URLS = {
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
            "https://adaway.org/hosts.txt"
    };

    private static final String ULTIMATE_URL =
            "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt";
    private static final String ADGUARD_DNS_URL =
            "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_15_DnsFilter/filter.txt";
    private static final String ANTI_BYPASS_URL =
            "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/doh-vpn-proxy-bypass-onlydomains.txt";

    private static final String CACHE_FILE = "remote_blocklist.txt";
    private static final int MAX_REMOTE_DOMAINS = 750_000;
    private static final int MIN_REMOTE_DOMAINS = 1_000;
    private static final double SAME_MODE_MIN_RATIO = 0.45d;
    private static final int MAX_REMOTE_REDIRECTS = 4;
    private static final long MAX_REMOTE_BYTES = 64L * 1024L * 1024L;
    private static final String[] REMOTE_HOST_SUFFIXES = {
            "githubusercontent.com", "jsdelivr.net", "adaway.org"
    };

    private static volatile long[] BLOCKED = new long[0];
    private static volatile Set<String> ALLOWED = Collections.emptySet();
    private static volatile boolean fullLoaded;

    private BlocklistManager() {}

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

    static synchronized int updateRemote(Context context) throws IOException {
        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        File dst = new File(context.getFilesDir(), CACHE_FILE);
        File bak = new File(context.getFilesDir(), CACHE_FILE + ".bak");
        int written = 0;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean ultra = prefs.getBoolean(KEY_STRICT, false);
        String mode = ultra ? "ULTRA" : "STANDARD";
        String previousMode = prefs.getString(KEY_CACHE_MODE, "");
        int previousCount = dst.isFile() ? countUniqueCacheEntries(dst, MAX_REMOTE_DOMAINS) : 0;

        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(tmp), StandardCharsets.UTF_8), 64 * 1024)) {
            if (ultra) {
                written += downloadInto(ULTIMATE_URL, writer, MAX_REMOTE_DOMAINS - written);
                if (written < MAX_REMOTE_DOMAINS)
                    written += downloadInto(ADGUARD_DNS_URL, writer, MAX_REMOTE_DOMAINS - written);
                if (written < MAX_REMOTE_DOMAINS)
                    written += downloadInto(ANTI_BYPASS_URL, writer, MAX_REMOTE_DOMAINS - written);
            } else {
                for (String url : NORMAL_URLS) {
                    if (written >= MAX_REMOTE_DOMAINS) break;
                    written += downloadInto(url, writer, MAX_REMOTE_DOMAINS - written);
                }
            }
        } catch (Throwable t) {
            tmp.delete();
            if (t instanceof IOException) throw (IOException)t;
            throw new IOException("Błąd pobierania list: " + t.getClass().getSimpleName(), t);
        }

        int uniqueDownloaded = countUniqueCacheEntries(tmp, MAX_REMOTE_DOMAINS);
        if (!candidateCountLooksHealthy(previousMode, mode, previousCount, uniqueDownloaded)) {
            tmp.delete();
            throw new IOException("Nowa lista wygląda na niepełną: unique=" + uniqueDownloaded +
                    " raw=" + written + " (poprzednio unique=" + previousCount + ", tryb " + mode + ")");
        }

        replaceCacheRollbackSafe(tmp, dst, bak);

        prefs.edit()
                .putLong(KEY_LAST_UPDATE, System.currentTimeMillis())
                .putString(KEY_CACHE_MODE, mode)
                .apply();
        int count = load(context);
        try {
            SystemLogStore.info(context, "BLOCKLIST",
                    "Lista v1.6 załadowana • mode=" + mode +
                            " • downloadedRaw=" + written + " • downloadedUnique=" + uniqueDownloaded +
                            " • previousUnique=" + previousCount + " • activeUnique=" + count);
        } catch (Throwable ignored) {}
        return count;
    }

    static synchronized void clearRemoteCache(Context context) {
        File cache = new File(context.getFilesDir(), CACHE_FILE);
        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        File bak = new File(context.getFilesDir(), CACHE_FILE + ".bak");
        if (cache.exists()) cache.delete();
        if (tmp.exists()) tmp.delete();
        if (bak.exists()) bak.delete();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_LAST_UPDATE).remove(KEY_CACHE_MODE).putBoolean(KEY_STRICT, false).apply();
        bootstrap(context);
    }

    static boolean candidateCountLooksHealthy(String previousMode, String newMode, int previousCount, int newCount) {
        if (newCount < MIN_REMOTE_DOMAINS) return false;
        if (previousCount < MIN_REMOTE_DOMAINS * 2) return true;
        if (previousMode == null || newMode == null || !previousMode.equals(newMode)) return true;
        int minimum = Math.max(MIN_REMOTE_DOMAINS, (int)Math.floor(previousCount * SAME_MODE_MIN_RATIO));
        return newCount >= minimum;
    }

    static int countUniqueNormalized(InputStream input, int max) throws IOException {
        if (input == null || max <= 0) return 0;
        LongCollector c = new LongCollector(Math.min(32_768, Math.max(16, max)));
        parseDomainStream(input, c, max);
        return c.toSortedUnique().length;
    }

    private static int countUniqueCacheEntries(File file, int max) throws IOException {
        if (file == null || !file.isFile()) return 0;
        try (InputStream in = new FileInputStream(file)) {
            return countUniqueNormalized(in, max);
        }
    }

    private static void replaceCacheRollbackSafe(File tmp, File dst, File bak) throws IOException {
        if (!tmp.isFile() || tmp.length() <= 0) throw new IOException("Brak nowej listy tymczasowej");
        if (bak.exists() && !bak.delete()) throw new IOException("Nie można usunąć starej kopii bezpieczeństwa");
        boolean hadOld = dst.isFile();
        if (hadOld && !dst.renameTo(bak)) throw new IOException("Nie można zabezpieczyć starej listy");
        boolean installed = false;
        try {
            installed = tmp.renameTo(dst);
            if (!installed) throw new IOException("Nie można zapisać nowej listy");
        } finally {
            if (!installed && hadOld && bak.isFile()) {
                if (dst.exists()) dst.delete();
                bak.renameTo(dst);
            }
        }
        if (bak.exists() && !bak.delete()) bak.deleteOnExit();
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
    }

    private static int downloadInto(String source, BufferedWriter writer, int max) throws IOException {
        if (max <= 0) return 0;
        HttpURLConnection conn = openTrustedRemote(source);
        int count = 0;
        try (InputStream limited = boundedRemoteInput(conn.getInputStream(), MAX_REMOTE_BYTES);
             BufferedReader reader = new BufferedReader(new InputStreamReader(
                     limited, StandardCharsets.UTF_8), 64 * 1024)) {
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

    private static HttpURLConnection openTrustedRemote(String source) throws IOException {
        URL current = new URL(source);
        for (int hop = 0; hop <= MAX_REMOTE_REDIRECTS; hop++) {
            if (!isAllowedRemoteUrl(current.toString())) {
                throw new IOException("Niedozwolony adres listy: " + current);
            }
            HttpURLConnection conn = (HttpURLConnection) current.openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(50_000);
            conn.setRequestProperty("User-Agent", "xADKiller/1.6");
            conn.setRequestProperty("Accept", "text/plain, application/octet-stream;q=0.9");
            // Keep the byte ceiling meaningful on the exact payload parsed by the app.
            // A trusted feed is plain text, so unexpected compression is rejected instead
            // of allowing a tiny compressed response to expand past the intended budget.
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setInstanceFollowRedirects(false);
            int code = conn.getResponseCode();
            if (isRedirectCode(code)) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("Przekierowanie bez Location z " + current);
                }
                current = new URL(current, location.trim());
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("HTTP " + code + " z " + current);
            }
            long declared = conn.getContentLengthLong();
            if (declared > MAX_REMOTE_BYTES) {
                conn.disconnect();
                throw new IOException("Lista przekracza limit " + MAX_REMOTE_BYTES + " B: " + current);
            }
            String contentType = conn.getContentType();
            if (!isAllowedRemoteContentType(contentType)) {
                conn.disconnect();
                throw new IOException("Nieprawidłowy Content-Type listy: " + contentType + " z " + current);
            }
            String contentEncoding = conn.getContentEncoding();
            if (!isAllowedRemoteContentEncoding(contentEncoding)) {
                conn.disconnect();
                throw new IOException("Nieoczekiwane kodowanie listy: " + contentEncoding + " z " + current);
            }
            return conn;
        }
        throw new IOException("Za dużo przekierowań listy: " + source);
    }

    private static boolean isRedirectCode(int code) {
        return code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307 || code == 308;
    }

    static boolean isAllowedRemoteUrl(String value) {
        try {
            URL url = new URL(value);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
            if (url.getUserInfo() != null) return false;
            int port = url.getPort();
            if (port != -1 && port != 443) return false;
            String host = url.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            for (String suffix : REMOTE_HOST_SUFFIXES) {
                if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
            }
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean isAllowedRemoteContentType(String value) {
        // Some otherwise valid raw/CDN responses omit Content-Type, so preserve
        // compatibility when the header is absent. When a server does advertise a type,
        // fail closed on HTML/JSON/script/error documents instead of parsing them as a list.
        if (value == null || value.trim().isEmpty()) return true;
        String type = value;
        int separator = type.indexOf(';');
        if (separator >= 0) type = type.substring(0, separator);
        type = type.trim().toLowerCase(Locale.ROOT);
        return "text/plain".equals(type) || "application/octet-stream".equals(type);
    }

    static boolean isAllowedRemoteContentEncoding(String value) {
        if (value == null || value.trim().isEmpty()) return true;
        return "identity".equalsIgnoreCase(value.trim());
    }

    static InputStream boundedRemoteInput(InputStream input, long maxBytes) {
        return new BoundedRemoteInputStream(input, maxBytes);
    }

    private static void parseDomainStream(InputStream input, LongCollector out, int max) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                input, StandardCharsets.UTF_8), 64 * 1024)) {
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
        if (line.isEmpty()) return null;
        if (line.charAt(0) == '#' || line.charAt(0) == '!' || line.charAt(0) == '[') return null;
        if (line.startsWith("@@")) return null;
        if (line.contains("##") || line.contains("#@#") || line.contains("#$#")) return null;
        int hash = line.indexOf('#');
        if (hash >= 0) line = line.substring(0, hash).trim();
        if (line.isEmpty()) return null;
        if (line.startsWith("||")) {
            String d = line.substring(2);
            int cut = d.length();
            int p = d.indexOf('^'); if (p >= 0 && p < cut) cut = p;
            p = d.indexOf('$'); if (p >= 0 && p < cut) cut = p;
            p = d.indexOf('/'); if (p >= 0 && p < cut) cut = p;
            p = d.indexOf('|'); if (p >= 0 && p < cut) cut = p;
            if (cut <= 0) return null;
            return normalize(d.substring(0, cut));
        }
        if (line.startsWith("/") || line.startsWith("|") || line.contains("://")) return null;
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
        if (d.isEmpty() || d.length() > 253 || d.equals("localhost") ||
                d.equals("localhost.localdomain") || d.equals("broadcasthost")) return null;
        if (!d.contains(".")) return null;
        for (int i = 0; i < d.length(); i++) {
            char c = d.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                    c == '.' || c == '_' || c == '-';
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

    private static final class BoundedRemoteInputStream extends InputStream {
        private final InputStream delegate;
        private final long maxBytes;
        private long consumed;

        BoundedRemoteInputStream(InputStream delegate, long maxBytes) {
            if (delegate == null) throw new IllegalArgumentException("input == null");
            if (maxBytes < 0L) throw new IllegalArgumentException("maxBytes < 0");
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        @Override public int read() throws IOException {
            int value = delegate.read();
            if (value < 0) return -1;
            if (consumed >= maxBytes) throw new IOException("Remote blocklist exceeds byte limit");
            consumed++;
            return value;
        }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            long remaining = maxBytes - consumed;
            if (remaining <= 0L) {
                int probe = delegate.read();
                if (probe < 0) return -1;
                throw new IOException("Remote blocklist exceeds byte limit");
            }
            int allowed = (int)Math.min((long)length, remaining);
            int read = delegate.read(buffer, offset, allowed);
            if (read > 0) consumed += read;
            return read;
        }

        @Override public void close() throws IOException {
            delegate.close();
        }
    }

    private static final class LongCollector {
        private long[] data;
        private int size;

        LongCollector(int initial) { data = new long[Math.max(16, initial)]; }
        void add(long v) {
            if (size == data.length)
                data = Arrays.copyOf(data, data.length + (data.length >> 1) + 1024);
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