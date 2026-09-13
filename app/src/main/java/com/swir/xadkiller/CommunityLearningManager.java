package com.swir.xadkiller;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Curated community intelligence. It reads public filter-list text from trusted
 * GitHub projects and extracts only harmless identifier-like ad signals.
 * No code from those repositories is ever executed.
 */
final class CommunityLearningManager {
    static final String KEY_COUNT = "community_ai_count";
    static final String KEY_LAST_UPDATE = "community_ai_last_update";
    private static final String CACHE_FILE = "community_ai_tokens.txt";
    private static final int MAX_TOKENS = 1400;
    private static final int MAX_SOURCE_BYTES = 3 * 1024 * 1024;
    private static final long AUTO_REFRESH_MS = 5L * 24L * 60L * 60L * 1000L;

    private static final String[] SOURCES = {
            "https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt",
            "https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/AnnoyancesFilter/MobileApp/sections/mobile-app_specific.txt",
            "https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/AnnoyancesFilter/Popups/sections/antiadblock.txt"
    };

    private static volatile Set<String> TOKENS = Collections.emptySet();
    private static volatile boolean loaded;

    private CommunityLearningManager() {}

    static synchronized int load(Context context) {
        if (loaded) return TOKENS.size();
        HashSet<String> out = new HashSet<>();
        // Small built-in seed so the engine works before the first network update.
        String[] seed = {
                "adslot","ad_slot","ad-slot","adunit","ad_unit","ad-unit","advertisement",
                "adcontainer","ad_container","ad-container","adwrapper","ad_wrapper","ad-wrapper",
                "adbanner","ad_banner","ad-banner","nativead","native_ad","native-ad",
                "rewarded_ad","rewarded-ad","interstitial_ad","interstitial-ad",
                "sponsored","sponsored-content","sponsored_products","sponsored-products",
                "promoted","promoted-content","adchoices","adsbygoogle","skip_ad","skip-ad",
                "ad_skip","ad-skip","close_ad","close-ad"
        };
        Collections.addAll(out, seed);

        File f = new File(context.getFilesDir(), CACHE_FILE);
        if (f.isFile()) {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null && out.size() < MAX_TOKENS) {
                    String n = normalizeToken(line);
                    if (n != null) out.add(n);
                }
            } catch (Exception e) {
                SystemLogStore.error(context, "AI_COMMUNITY", "Nie udało się wczytać cache Community AI", e);
            }
        }
        TOKENS = Collections.unmodifiableSet(out);
        loaded = true;
        return TOKENS.size();
    }

    static int matchBonus(Context context, String value, Set<String> matchedFeatures) {
        if (value == null || value.isEmpty()) return 0;
        load(context);
        String low = value.toLowerCase(Locale.ROOT);
        int hits = 0;
        for (String token : TOKENS) {
            if (low.contains(token)) {
                hits++;
                if (matchedFeatures != null) matchedFeatures.add("community:" + token);
                if (hits >= 3) break;
            }
        }
        if (hits == 0) return 0;
        return Math.min(30, 10 + (hits - 1) * 8);
    }

    static boolean shouldAutoRefresh(Context context) {
        long last = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_UPDATE, 0);
        return last <= 0 || System.currentTimeMillis() - last > AUTO_REFRESH_MS;
    }

    static synchronized int update(Context context) throws Exception {
        HashSet<String> found = new HashSet<>();
        for (String source : SOURCES) {
            if (found.size() >= MAX_TOKENS) break;
            extractFromSource(source, found);
        }
        if (found.size() < 20) throw new IllegalStateException("Za mało sygnałów Community AI: " + found.size());

        File tmp = new File(context.getFilesDir(), CACHE_FILE + ".tmp");
        File dst = new File(context.getFilesDir(), CACHE_FILE);
        try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8))) {
            for (String t : found) { w.write(t); w.newLine(); }
        }
        if (dst.exists() && !dst.delete()) throw new IllegalStateException("Nie można podmienić cache Community AI");
        if (!tmp.renameTo(dst)) throw new IllegalStateException("Nie można zapisać cache Community AI");

        loaded = false;
        int count = load(context);
        context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).edit()
                .putInt(KEY_COUNT, count)
                .putLong(KEY_LAST_UPDATE, System.currentTimeMillis())
                .apply();
        SystemLogStore.info(context, "AI_COMMUNITY", "Community AI zaktualizowane • tokens=" + count + " • sources=" + SOURCES.length);
        return count;
    }

    static int count(Context context) { return load(context); }

    static synchronized void clear(Context context) {
        File f = new File(context.getFilesDir(), CACHE_FILE);
        if (f.exists()) f.delete();
        loaded = false;
        TOKENS = Collections.emptySet();
        context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_COUNT).remove(KEY_LAST_UPDATE).apply();
        load(context);
    }

    private static void extractFromSource(String source, Set<String> out) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL(source).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "xADKiller/1.4 CommunityAI");
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code < 200 || code >= 300) { c.disconnect(); throw new IllegalStateException("HTTP " + code + " • " + source); }
        int bytes = 0;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8), 64 * 1024)) {
            String line;
            while ((line = r.readLine()) != null && out.size() < MAX_TOKENS && bytes < MAX_SOURCE_BYTES) {
                bytes += line.length() + 1;
                extractTokens(line, out);
            }
        } finally { c.disconnect(); }
    }

    private static void extractTokens(String line, Set<String> out) {
        if (line == null || line.isEmpty() || line.startsWith("!")) return;
        String low = line.toLowerCase(Locale.ROOT);
        StringBuilder token = new StringBuilder();
        for (int i=0;i<=low.length();i++) {
            char ch = i < low.length() ? low.charAt(i) : ' ';
            boolean allowed = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-';
            if (allowed) {
                if (token.length() < 72) token.append(ch);
            } else {
                if (token.length() >= 4) {
                    String t = token.toString();
                    if (looksAdRelated(t)) {
                        String n = normalizeToken(t);
                        if (n != null) out.add(n);
                    }
                }
                token.setLength(0);
                if (out.size() >= MAX_TOKENS) return;
            }
        }
    }

    private static boolean looksAdRelated(String t) {
        if (t == null) return false;
        if (t.contains("sponsor") || t.contains("advert") || t.contains("promoted") || t.contains("adchoice") || t.contains("adsby")) return true;
        if (t.contains("interstitial") || t.contains("rewarded") || t.contains("nativead") || t.contains("native-ad") || t.contains("native_ad")) return true;
        if (t.contains("adslot") || t.contains("ad-slot") || t.contains("ad_slot") || t.contains("adunit") || t.contains("ad-unit") || t.contains("ad_unit")) return true;
        if (t.contains("adcontainer") || t.contains("ad-container") || t.contains("ad_container") || t.contains("adwrapper") || t.contains("ad-wrapper") || t.contains("ad_wrapper")) return true;
        if (t.contains("skipad") || t.contains("skip-ad") || t.contains("skip_ad") || t.contains("adskip") || t.contains("ad-skip") || t.contains("ad_skip")) return true;
        if (t.contains("closead") || t.contains("close-ad") || t.contains("close_ad")) return true;
        return t.startsWith("ad-") || t.startsWith("ad_") || t.endsWith("-ads") || t.endsWith("_ads");
    }

    private static String normalizeToken(String token) {
        if (token == null) return null;
        String t = token.trim().toLowerCase(Locale.ROOT);
        if (t.length() < 4 || t.length() > 72) return null;
        for (int i=0;i<t.length();i++) {
            char c=t.charAt(i);
            boolean ok=(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-';
            if(!ok)return null;
        }
        return t;
    }
}
