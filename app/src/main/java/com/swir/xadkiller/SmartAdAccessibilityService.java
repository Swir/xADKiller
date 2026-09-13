package com.swir.xadkiller;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * xADKiller Smart Ad Engine v1.3.
 *
 * Phase 1 is intentionally local and lightweight: it scores the accessibility
 * tree for advertising signals, can press explicit Skip/Close-Ad controls and
 * optionally mutes STREAM_MUSIC while an ad is strongly detected. No screen,
 * audio or accessibility content is uploaded anywhere.
 */
public class SmartAdAccessibilityService extends AccessibilityService {
    static final String KEY_SMART_ENABLED = "smart_engine_enabled";
    static final String KEY_AUTO_SKIP = "smart_auto_skip";
    static final String KEY_MUTE_ADS = "smart_mute_ads";
    static final String KEY_DETECTIONS = "smart_detections";
    static final String KEY_ACTIONS = "smart_actions";
    static final String KEY_LAST_APP = "smart_last_app";
    static final String KEY_HEARTBEAT = "smart_service_heartbeat";

    private static final long ANALYZE_MIN_MS = 220;
    private static final long DUPLICATE_LOG_MS = 4500;
    private static final long ACTION_COOLDOWN_MS = 1700;
    private static final long MUTE_FAILSAFE_MS = 18000;
    private static final int MAX_NODES = 420;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastAnalyzeAt;
    private long lastDetectionAt;
    private long lastDetectionLoggedAt;
    private long lastActionAt;
    private String lastDetectionKey = "";
    private long lastHeartbeatWrite;
    private int savedMusicVolume = -1;
    private boolean mutedByUs;

    private final Runnable restoreRunnable = new Runnable() {
        @Override public void run() {
            if (!mutedByUs) return;
            long age = System.currentTimeMillis() - lastDetectionAt;
            if (age < MUTE_FAILSAFE_MS - 400) {
                handler.postDelayed(this, Math.max(500, MUTE_FAILSAFE_MS - age));
                return;
            }
            restoreAudio("timeout / brak dalszych sygnałów reklamy");
        }
    };

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        getPrefs().edit().putLong(KEY_HEARTBEAT, System.currentTimeMillis()).apply();
        SystemLogStore.info(this, "SMART", "Smart Ad Engine v1.3 połączony z AccessibilityService");
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        SharedPreferences prefs = getPrefs();
        long now = System.currentTimeMillis();
        if (now - lastHeartbeatWrite > 4000) {
            lastHeartbeatWrite = now;
            prefs.edit().putLong(KEY_HEARTBEAT, now).apply();
        }

        if (!prefs.getBoolean(KEY_SMART_ENABLED, true)) {
            restoreAudio("Smart Engine wyłączony");
            return;
        }
        if (now - lastAnalyzeAt < ANALYZE_MIN_MS) return;
        lastAnalyzeAt = now;

        CharSequence packageCs = event.getPackageName();
        if (packageCs == null) return;
        String pkg = packageCs.toString();
        if (pkg.equals(getPackageName()) || pkg.startsWith("com.swir.xadkiller")) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        ScanResult scan = scanTree(root);
        if (scan.score < 60) return;

        lastDetectionAt = now;
        handler.removeCallbacks(restoreRunnable);
        handler.postDelayed(restoreRunnable, MUTE_FAILSAFE_MS);

        String app = appLabel(pkg);
        String key = pkg + "|" + scan.signature;
        boolean duplicate = key.equals(lastDetectionKey) && now - lastDetectionLoggedAt < DUPLICATE_LOG_MS;
        if (!duplicate) {
            lastDetectionKey = key;
            lastDetectionLoggedAt = now;
            long d = prefs.getLong(KEY_DETECTIONS, 0) + 1;
            prefs.edit().putLong(KEY_DETECTIONS, d).putString(KEY_LAST_APP, app + " • " + pkg).apply();
            SystemLogStore.add(this, "SMART", "AD_DETECTED",
                    app + " • score=" + scan.score + "%",
                    "package=" + pkg + " • signals=" + scan.signature);
        }

        boolean acted = false;
        if (prefs.getBoolean(KEY_AUTO_SKIP, true) && scan.skipNode != null && scan.score >= 70 && now - lastActionAt >= ACTION_COOLDOWN_MS) {
            AccessibilityNodeInfo clickable = findClickable(scan.skipNode);
            if (clickable != null) {
                try {
                    if (clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        lastActionAt = now;
                        acted = true;
                        SystemLogStore.info(this, "SMART_ACTION", "AUTO-SKIP • " + app + " • " + pkg + " • score=" + scan.score + "%");
                    }
                } catch (Throwable t) {
                    SystemLogStore.error(this, "SMART_ACTION", "Auto-skip nieudany dla " + pkg, t);
                }
            }
        }

        if (prefs.getBoolean(KEY_MUTE_ADS, false) && scan.score >= 78) {
            if (muteAudio(app, pkg, scan.score)) acted = true;
        }

        if (acted) prefs.edit().putLong(KEY_ACTIONS, prefs.getLong(KEY_ACTIONS, 0) + 1).apply();
    }

    @Override public void onInterrupt() {
        SystemLogStore.warn(this, "SMART", "AccessibilityService przerwany przez Android");
        restoreAudio("service interrupt");
    }

    @Override public void onDestroy() {
        restoreAudio("service destroy");
        getPrefs().edit().putLong(KEY_HEARTBEAT, 0).apply();
        SystemLogStore.info(this, "SMART", "Smart Ad Engine zatrzymany");
        super.onDestroy();
    }

    private ScanResult scanTree(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        int nodes = 0;
        int score = 0;
        AccessibilityNodeInfo skip = null;
        Set<String> signals = new HashSet<>();

        while (!q.isEmpty() && nodes++ < MAX_NODES) {
            AccessibilityNodeInfo n = q.removeFirst();
            String text = normalized(n);
            String id = n.getViewIdResourceName();
            String idLow = id == null ? "" : id.toLowerCase(Locale.ROOT);

            if (!text.isEmpty()) {
                if (containsAny(text,
                        "skip ad", "skip ads", "pomiń reklamę", "pomin reklamę", "pomiń reklamy",
                        "close ad", "zamknij reklamę", "zamknij reklame", "przejdź dalej po reklamie")) {
                    score += 75; signals.add("skip-control"); if (skip == null) skip = n;
                }
                if (containsAny(text, "advertisement", "reklama")) {
                    score += 62; signals.add("ad-label");
                }
                if (containsAny(text, "sponsored", "sponsorowane", "promoted", "promowane")) {
                    score += 38; signals.add("sponsored-label");
                }
                if (containsAny(text, "ad choices", "ads by", "why this ad", "dlaczego ta reklama", "treść sponsorowana", "tresc sponsorowana")) {
                    score += 45; signals.add("ad-metadata");
                }
                if (containsAny(text, "video will resume", "film zostanie wznowiony", "music will resume", "muzyka zostanie wznowiona")) {
                    score += 40; signals.add("resume-label");
                }
            }

            if (!idLow.isEmpty()) {
                if (containsAny(idLow, "skip_ad", "ad_skip", "skipad", "close_ad", "ad_close")) {
                    score += 80; signals.add("ad-view-id"); if (skip == null) skip = n;
                } else if (containsAny(idLow, "advertisement", "ad_badge", "sponsored")) {
                    score += 35; signals.add("ad-view-id-label");
                }
            }

            int childCount = n.getChildCount();
            for (int i=0;i<childCount;i++) {
                AccessibilityNodeInfo child = n.getChild(i);
                if (child != null) q.addLast(child);
            }
            if (score >= 100 && skip != null) break;
        }

        score = Math.min(99, score);
        String signature = signals.isEmpty() ? "unknown" : String.join(",", signals);
        return new ScanResult(score, signature, skip);
    }

    private static String normalized(AccessibilityNodeInfo n) {
        StringBuilder b = new StringBuilder();
        CharSequence t = n.getText();
        CharSequence d = n.getContentDescription();
        if (t != null) b.append(t).append(' ');
        if (d != null) b.append(d);
        return b.toString().trim().toLowerCase(Locale.ROOT);
    }

    private static boolean containsAny(String value, String... needles) {
        for (String s : needles) if (value.contains(s)) return true;
        return false;
    }

    private AccessibilityNodeInfo findClickable(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo n = node;
        for (int i=0; n!=null && i<5; i++) {
            if (n.isClickable() && n.isEnabled()) return n;
            n = n.getParent();
        }
        return null;
    }

    private boolean muteAudio(String app, String pkg, int score) {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return false;
            if (!mutedByUs) {
                int current = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                if (current <= 0) return false;
                savedMusicVolume = current;
                am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
                mutedByUs = true;
                SystemLogStore.info(this, "SMART_AUDIO", "MUTE • " + app + " • " + pkg + " • score=" + score + "% • previousVolume=" + current);
                return true;
            }
        } catch (Throwable t) {
            SystemLogStore.error(this, "SMART_AUDIO", "Nie udało się wyciszyć reklamy", t);
        }
        return false;
    }

    private void restoreAudio(String reason) {
        if (!mutedByUs) return;
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null && savedMusicVolume >= 0) {
                am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusicVolume, 0);
                SystemLogStore.info(this, "SMART_AUDIO", "RESTORE • volume=" + savedMusicVolume + " • " + reason);
            }
        } catch (Throwable t) {
            SystemLogStore.error(this, "SMART_AUDIO", "Nie udało się przywrócić głośności", t);
        } finally {
            mutedByUs = false;
            savedMusicVolume = -1;
        }
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            return label == null ? pkg : label.toString();
        } catch (Exception e) { return pkg; }
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE);
    }

    private static final class ScanResult {
        final int score;
        final String signature;
        final AccessibilityNodeInfo skipNode;
        ScanResult(int score, String signature, AccessibilityNodeInfo skipNode) {
            this.score = score;
            this.signature = signature;
            this.skipNode = skipNode;
        }
    }
}
