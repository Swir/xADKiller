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
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

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
    private static final int MAX_DOMAINS = 420_000;

    private static final AtomicReference<Set<String>> BLOCKED = new AtomicReference<>(Collections.emptySet());
    private static final AtomicReference<Set<String>> ALLOWED = new AtomicReference<>(Collections.emptySet());

    private BlocklistManager() {}

    static synchronized int load(Context context) {
        HashSet<String> blocked = new HashSet<>();
        HashSet<String> allowed = new HashSet<>();
        try (InputStream in = context.getAssets().open("default_blocklist.txt")) { parseDomainStream(in, blocked, MAX_DOMAINS); } catch (IOException ignored) {}
        File cache = new File(context.getFilesDir(), CACHE_FILE);
        if (cache.isFile()) try (InputStream in = new FileInputStream(cache)) { parseDomainStream(in, blocked, MAX_DOMAINS); } catch (IOException ignored) {}

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> custom = prefs.getStringSet(KEY_CUSTOM_BLOCK, Collections.emptySet());
        Set<String> allow = prefs.getStringSet(KEY_ALLOW, Collections.emptySet());
        if (custom != null) for (String d : custom) addNormalized(blocked, d);
        if (allow != null) for (String d : allow) addNormalized(allowed, d);
        BLOCKED.set(Collections.unmodifiableSet(blocked));
        ALLOWED.set(Collections.unmodifiableSet(allowed));
        return blocked.size();
    }

    static boolean isBlocked(String domain) {
        String d = normalize(domain);
        if (d == null) return false;
        Set<String> allow = ALLOWED.get();
        Set<String> block = BLOCKED.get();
        String current = d;
        while (true) {
            if (allow.contains(current)) return false;
            int dot = current.indexOf('.');
            if (dot < 0) break;
            current = current.substring(dot + 1);
        }
        current = d;
        while (true) {
            if (block.contains(current)) return true;
            int dot = current.indexOf('.');
            if (dot < 0) return false;
            current = current.substring(dot + 1);
        }
    }

    static int currentCount() { return BLOCKED.get().size(); }

    static synchronized int updateRemote(Context context) throws IOException {
        HashSet<String> parsed = new HashSet<>();
        for (String url : NORMAL_URLS) downloadInto(url, parsed);
        boolean pro = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_STRICT, false);
        if (pro) downloadInto(PRO_URL, parsed);
        if (parsed.size() < 1000) throw new IOException("Lista wygląda na niepełną: " + parsed.size());

        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        File dst = new File(context.getFilesDir(), CACHE_FILE);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8))) {
            for (String d : parsed) { writer.write(d); writer.newLine(); }
        }
        if (dst.exists() && !dst.delete()) throw new IOException("Nie można podmienić starej listy");
        if (!tmp.renameTo(dst)) throw new IOException("Nie można zapisać listy");
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_LAST_UPDATE, System.currentTimeMillis()).apply();
        return load(context);
    }

    private static void downloadInto(String source, Set<String> parsed) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(source).openConnection();
        conn.setConnectTimeout(12_000);
        conn.setReadTimeout(35_000);
        conn.setRequestProperty("User-Agent", "xADKiller/1.1");
        conn.setInstanceFollowRedirects(true);
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) { conn.disconnect(); throw new IOException("HTTP " + code); }
        try (InputStream in = conn.getInputStream()) { parseDomainStream(in, parsed, MAX_DOMAINS); }
        finally { conn.disconnect(); }
    }

    static void addCustomBlock(Context context, String domain) { updateSet(context, KEY_CUSTOM_BLOCK, domain, true); updateSet(context, KEY_ALLOW, domain, false); load(context); }
    static void addAllow(Context context, String domain) { updateSet(context, KEY_ALLOW, domain, true); updateSet(context, KEY_CUSTOM_BLOCK, domain, false); load(context); }
    static void clearCustomRules(Context context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_CUSTOM_BLOCK).remove(KEY_ALLOW).apply(); load(context); }

    private static void updateSet(Context context, String key, String domain, boolean add) {
        String n = normalize(domain); if (n == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        HashSet<String> copy = new HashSet<>(); Set<String> old = prefs.getStringSet(key, Collections.emptySet()); if (old != null) copy.addAll(old);
        if (add) copy.add(n); else copy.remove(n); prefs.edit().putStringSet(key, copy).apply();
    }

    private static void parseDomainStream(InputStream input, Set<String> out, int max) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && out.size() < max) {
                line = line.trim(); if (line.isEmpty() || line.startsWith("#")) continue;
                int hash = line.indexOf('#'); if (hash >= 0) line = line.substring(0, hash).trim(); if (line.isEmpty()) continue;
                String candidate; String[] parts = line.split("\\s+");
                if (parts.length >= 2 && looksLikeIp(parts[0])) candidate = parts[1]; else candidate = parts[0];
                addNormalized(out, candidate);
            }
        }
    }

    private static boolean looksLikeIp(String s) { return s.indexOf(':') >= 0 || s.matches("\\d{1,3}(\\.\\d{1,3}){3}"); }
    private static void addNormalized(Set<String> out, String domain) { String n = normalize(domain); if (n != null) out.add(n); }

    static String normalize(String domain) {
        if (domain == null) return null;
        String d = domain.trim().toLowerCase(Locale.ROOT);
        if (d.startsWith("http://") || d.startsWith("https://")) try { d = new URL(d).getHost().toLowerCase(Locale.ROOT); } catch (Exception e) { return null; }
        while (d.startsWith("*.")) d = d.substring(2);
        while (d.endsWith(".")) d = d.substring(0, d.length() - 1);
        if (d.isEmpty() || d.length() > 253 || d.equals("localhost") || d.equals("localhost.localdomain") || d.equals("broadcasthost")) return null;
        if (!d.contains(".") || !d.matches("[a-z0-9._-]+")) return null;
        return d;
    }
}
