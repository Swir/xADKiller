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
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Lightweight on-device online learning for xADKiller.
 *
 * The model is deliberately small and explainable. It never stores full screen
 * text. Input feature names are hashed before persistence and only signed
 * integer weights are written to adaptive_model.tsv.
 */
final class AdaptiveLearningEngine {
    static final String KEY_ENABLED = "adaptive_ai_enabled";
    static final String KEY_SAMPLES = "adaptive_ai_samples";
    static final String KEY_POSITIVE = "adaptive_ai_positive";
    static final String KEY_NEGATIVE = "adaptive_ai_negative";
    static final String KEY_AUTO_LEARN = "adaptive_ai_auto_learn";
    static final String KEY_LAST_PKG = "adaptive_ai_last_pkg";
    static final String KEY_LAST_FEATURES = "adaptive_ai_last_features";
    static final String KEY_LAST_BASE = "adaptive_ai_last_base";
    static final String KEY_LAST_TIME = "adaptive_ai_last_time";

    private static final String MODEL_FILE = "adaptive_model.tsv";
    private static final int MAX_MODEL_FEATURES = 1400;
    private static final int MAX_OBSERVATION_FEATURES = 48;
    private static final int MAX_WEIGHT = 42;
    private static final long OBSERVE_WRITE_MIN_MS = 650;

    private static final Map<Long,Integer> WEIGHTS = new HashMap<>();
    private static boolean loaded;
    private static long lastObservationWrite;

    private AdaptiveLearningEngine() {}

    static synchronized void load(Context context) {
        if (loaded) return;
        WEIGHTS.clear();
        File f = new File(context.getFilesDir(), MODEL_FILE);
        if (f.isFile()) {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null && WEIGHTS.size() < MAX_MODEL_FEATURES) {
                    String[] p = line.split("\\t", 2);
                    if (p.length != 2) continue;
                    try {
                        long key = Long.parseUnsignedLong(p[0], 16);
                        int weight = Integer.parseInt(p[1]);
                        if (weight != 0) WEIGHTS.put(key, clamp(weight, -MAX_WEIGHT, MAX_WEIGHT));
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                SystemLogStore.error(context, "AI_MODEL", "Nie udało się wczytać modelu Adaptive AI", e);
            }
        }
        loaded = true;
    }

    static boolean isEnabled(Context c) {
        return c.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true);
    }

    /** Returns a signed score correction in the range -35..35. */
    static synchronized int predictAdjustment(Context context, String pkg, Set<String> rawFeatures) {
        if (!isEnabled(context) || rawFeatures == null || rawFeatures.isEmpty()) return 0;
        load(context);
        long sum = 0;
        int used = 0;
        for (long h : hashedFeatures(pkg, rawFeatures)) {
            Integer w = WEIGHTS.get(h);
            if (w != null) { sum += w; used++; }
        }
        if (used == 0) return 0;
        double divisor = Math.max(3.0, Math.sqrt(used) * 2.2);
        return clamp((int)Math.round(sum / divisor), -35, 35);
    }

    /**
     * Saves only hashes of the latest screen features, never raw node text.
     * The last observation is what the two feedback buttons train on.
     */
    static synchronized void observe(Context context, String pkg, Set<String> rawFeatures, int baseScore) {
        if (rawFeatures == null || rawFeatures.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (now - lastObservationWrite < OBSERVE_WRITE_MIN_MS) return;
        lastObservationWrite = now;

        List<Long> hashes = hashedFeatures(pkg, rawFeatures);
        if (hashes.size() > MAX_OBSERVATION_FEATURES) hashes = hashes.subList(0, MAX_OBSERVATION_FEATURES);
        StringBuilder b = new StringBuilder();
        for (long h : hashes) {
            if (b.length() > 0) b.append(',');
            b.append(Long.toUnsignedString(h, 16));
        }
        context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_LAST_PKG, safePkg(pkg))
                .putString(KEY_LAST_FEATURES, b.toString())
                .putInt(KEY_LAST_BASE, baseScore)
                .putLong(KEY_LAST_TIME, now)
                .apply();
    }

    static FeedbackResult trainLastFeedback(Context context, boolean wasAd) {
        SharedPreferences p = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        String encoded = p.getString(KEY_LAST_FEATURES, "");
        String pkg = p.getString(KEY_LAST_PKG, "");
        long when = p.getLong(KEY_LAST_TIME, 0);
        if (encoded == null || encoded.isEmpty() || when <= 0) {
            return new FeedbackResult(false, "Brak ostatniej obserwacji Smart Engine.", 0);
        }
        ArrayList<Long> hashes = decodeHashes(encoded);
        if (hashes.isEmpty()) return new FeedbackResult(false, "Ostatnia obserwacja nie zawiera cech do nauki.", 0);

        int delta = wasAd ? 5 : -7;
        int changed = applyDelta(context, hashes, delta);
        long samples = p.getLong(KEY_SAMPLES, 0) + 1;
        long positive = p.getLong(KEY_POSITIVE, 0) + (wasAd ? 1 : 0);
        long negative = p.getLong(KEY_NEGATIVE, 0) + (wasAd ? 0 : 1);
        p.edit().putLong(KEY_SAMPLES, samples).putLong(KEY_POSITIVE, positive).putLong(KEY_NEGATIVE, negative).apply();
        SystemLogStore.info(context, "AI_LEARN", (wasAd ? "POSITIVE" : "NEGATIVE") + " feedback • app=" + pkg + " • features=" + hashes.size() + " • changed=" + changed);
        return new FeedbackResult(true, (wasAd ? "Nauczono: to była reklama" : "Nauczono: fałszywy alarm") + " • " + pkg, changed);
    }

    /** Weak positive reinforcement after an actual Skip-Ad click succeeds. */
    static void reinforceSuccessfulAction(Context context, String pkg, Set<String> rawFeatures) {
        SharedPreferences p = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        if (!isEnabled(context) || !p.getBoolean(KEY_AUTO_LEARN, true) || rawFeatures == null || rawFeatures.isEmpty()) return;
        synchronized (AdaptiveLearningEngine.class) {
            List<Long> hashes = hashedFeatures(pkg, rawFeatures);
            int changed = applyDelta(context, hashes, 1);
            if (changed > 0) SystemLogStore.info(context, "AI_LEARN", "AUTO reinforcement po udanym Skip-Ad • " + safePkg(pkg) + " • changed=" + changed);
        }
    }

    static synchronized void reset(Context context) {
        WEIGHTS.clear();
        loaded = true;
        File f = new File(context.getFilesDir(), MODEL_FILE);
        if (f.exists()) f.delete();
        context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_SAMPLES).remove(KEY_POSITIVE).remove(KEY_NEGATIVE)
                .remove(KEY_LAST_FEATURES).remove(KEY_LAST_PKG).remove(KEY_LAST_BASE).remove(KEY_LAST_TIME)
                .apply();
        SystemLogStore.warn(context, "AI_MODEL", "Lokalny model Adaptive AI został zresetowany");
    }

    static Stats stats(Context context) {
        load(context);
        SharedPreferences p = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        return new Stats(
                p.getLong(KEY_SAMPLES, 0),
                p.getLong(KEY_POSITIVE, 0),
                p.getLong(KEY_NEGATIVE, 0),
                modelSize(),
                p.getString(KEY_LAST_PKG, ""),
                p.getInt(KEY_LAST_BASE, 0),
                p.getLong(KEY_LAST_TIME, 0));
    }

    private static synchronized int modelSize() { return WEIGHTS.size(); }

    private static int applyDelta(Context context, List<Long> hashes, int delta) {
        load(context);
        if (hashes == null || hashes.isEmpty()) return 0;
        int changed = 0;
        for (long h : hashes) {
            int old = WEIGHTS.getOrDefault(h, 0);
            int nw = clamp(old + delta, -MAX_WEIGHT, MAX_WEIGHT);
            if (nw == 0) WEIGHTS.remove(h); else WEIGHTS.put(h, nw);
            if (nw != old) changed++;
        }
        trimModelIfNeeded();
        save(context);
        return changed;
    }

    private static void trimModelIfNeeded() {
        if (WEIGHTS.size() <= MAX_MODEL_FEATURES) return;
        ArrayList<Map.Entry<Long,Integer>> entries = new ArrayList<>(WEIGHTS.entrySet());
        Collections.sort(entries, (a,b) -> Integer.compare(Math.abs(b.getValue()), Math.abs(a.getValue())));
        WEIGHTS.clear();
        int keep = Math.min(MAX_MODEL_FEATURES, entries.size());
        for (int i=0;i<keep;i++) WEIGHTS.put(entries.get(i).getKey(), entries.get(i).getValue());
    }

    private static void save(Context context) {
        File tmp = new File(context.getFilesDir(), MODEL_FILE + ".tmp");
        File dst = new File(context.getFilesDir(), MODEL_FILE);
        try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8))) {
            for (Map.Entry<Long,Integer> e : WEIGHTS.entrySet()) {
                w.write(Long.toUnsignedString(e.getKey(), 16));
                w.write('\t');
                w.write(Integer.toString(e.getValue()));
                w.newLine();
            }
        } catch (Exception e) {
            SystemLogStore.error(context, "AI_MODEL", "Nie udało się zapisać modelu Adaptive AI", e);
            tmp.delete();
            return;
        }
        if (dst.exists() && !dst.delete()) { tmp.delete(); return; }
        if (!tmp.renameTo(dst)) tmp.delete();
    }

    private static List<Long> hashedFeatures(String pkg, Set<String> rawFeatures) {
        ArrayList<Long> out = new ArrayList<>();
        HashSet<Long> seen = new HashSet<>();
        String p = safePkg(pkg);
        int count = 0;
        for (String feature : rawFeatures) {
            if (feature == null || feature.isEmpty()) continue;
            String f = feature.toLowerCase(Locale.ROOT);
            long global = hash64("g|" + f);
            long local = hash64("p|" + p + "|" + f);
            if (seen.add(global)) out.add(global);
            if (seen.add(local)) out.add(local);
            if (++count >= 24) break;
        }
        return out;
    }

    private static ArrayList<Long> decodeHashes(String encoded) {
        ArrayList<Long> out = new ArrayList<>();
        for (String s : encoded.split(",")) {
            if (s.isEmpty()) continue;
            try { out.add(Long.parseUnsignedLong(s, 16)); } catch (Exception ignored) {}
        }
        return out;
    }

    private static String safePkg(String pkg) { return pkg == null ? "" : pkg.trim(); }

    private static long hash64(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i=0;i<s.length();i++) { h ^= s.charAt(i); h *= 0x100000001b3L; }
        return h;
    }

    private static int clamp(int v, int min, int max) { return Math.max(min, Math.min(max, v)); }

    static final class FeedbackResult {
        final boolean ok;
        final String message;
        final int changed;
        FeedbackResult(boolean ok, String message, int changed) { this.ok=ok; this.message=message; this.changed=changed; }
    }

    static final class Stats {
        final long samples, positive, negative;
        final int modelFeatures;
        final String lastPackage;
        final int lastBaseScore;
        final long lastObservationTime;
        Stats(long samples,long positive,long negative,int modelFeatures,String lastPackage,int lastBaseScore,long lastObservationTime) {
            this.samples=samples; this.positive=positive; this.negative=negative; this.modelFeatures=modelFeatures;
            this.lastPackage=lastPackage; this.lastBaseScore=lastBaseScore; this.lastObservationTime=lastObservationTime;
        }
    }
}
