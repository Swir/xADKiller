package com.swir.xadkiller;

/** Pure lifecycle policy kept separate from BroadcastReceiver plumbing so restart behavior is testable. */
final class VpnLifecycleStartPolicy {
    static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    static final String ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    static final long PACKAGE_RESTART_HEARTBEAT_MAX_AGE_MS = 5L * 60L * 1000L;
    static final long DUPLICATE_RESTART_WINDOW_MS = 15L * 1000L;
    private static final long PACKAGE_RESTART_MAX_FUTURE_SKEW_MS = 30L * 1000L;

    private VpnLifecycleStartPolicy() {}

    static boolean isManagedRestartAction(String action) {
        return ACTION_BOOT_COMPLETED.equals(action) || ACTION_MY_PACKAGE_REPLACED.equals(action);
    }

    static boolean shouldStart(String action, boolean autoStartEnabled, boolean wasRunningBeforeRestart,
                               long heartbeatAtMs, long nowMs) {
        if (action == null) return false;

        // Device boot follows the explicit autostart preference. A package replacement is
        // different: Android has just killed our process while the user may have manually
        // enabled protection. Resume only a session backed by a recent heartbeat. This
        // prevents an old/corrupt persisted `running=true` bit from resurrecting protection
        // after an unrelated later update while preserving continuity for a genuinely live
        // VPN even when boot autostart is disabled.
        if (ACTION_BOOT_COMPLETED.equals(action)) return autoStartEnabled;
        if (ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return wasRunningBeforeRestart && isRecentHeartbeat(heartbeatAtMs, nowMs);
        }
        return false;
    }

    static boolean shouldStartWithConsent(String action, boolean autoStartEnabled, boolean wasRunningBeforeRestart,
                                          long heartbeatAtMs, long nowMs, boolean vpnConsentGranted) {
        return vpnConsentGranted && shouldStart(action, autoStartEnabled, wasRunningBeforeRestart, heartbeatAtMs, nowMs);
    }

    static boolean shouldSuppressStartAttempt(String action, boolean lifecycleAllowsStart,
                                              String lastAction, long lastAttemptElapsedMs, long nowElapsedMs) {
        return shouldSuppressStartAttempt(action, lifecycleAllowsStart, lastAction,
                lastAttemptElapsedMs, nowElapsedMs, -1, -1);
    }

    static boolean shouldSuppressStartAttempt(String action, boolean lifecycleAllowsStart,
                                              String lastAction, long lastAttemptElapsedMs, long nowElapsedMs,
                                              int lastBootCount, int currentBootCount) {
        // A non-starting lifecycle signal must never poison the short duplicate window for a
        // later legitimate BOOT/UPDATE start. Only suppress when this current signal itself
        // has already passed the lifecycle gate and therefore represents the same start work.
        return lifecycleAllowsStart
                && isDuplicateRestart(action, lastAction, lastAttemptElapsedMs, nowElapsedMs,
                lastBootCount, currentBootCount);
    }

    static boolean isDuplicateRestart(String action, String lastAction, long lastAttemptElapsedMs, long nowElapsedMs) {
        return isDuplicateRestart(action, lastAction, lastAttemptElapsedMs, nowElapsedMs, -1, -1);
    }

    static boolean isDuplicateRestart(String action, String lastAction, long lastAttemptElapsedMs, long nowElapsedMs,
                                      int lastBootCount, int currentBootCount) {
        // Duplicate suppression is driven by SystemClock.elapsedRealtime(), not wall time,
        // and applies only to repeats of the SAME lifecycle action. Persisted elapsedRealtime
        // values are ambiguous across reboots: a previous boot can have recorded a small value
        // and the next BOOT_COMPLETED can arrive later than that value, accidentally looking
        // like a same-boot duplicate. When Android exposes BOOT_COUNT, require the persisted
        // marker to carry the same generation. An older marker that predates boot-count-aware
        // storage is deliberately treated as untrusted rather than suppressing a real reboot.
        if (!isManagedRestartAction(action) || !action.equals(lastAction)) return false;
        if (currentBootCount >= 0) {
            if (lastBootCount < 0 || lastBootCount != currentBootCount) return false;
        }
        if (lastAttemptElapsedMs <= 0L || nowElapsedMs <= 0L) return false;
        long ageMs = nowElapsedMs - lastAttemptElapsedMs;
        return ageMs >= 0L && ageMs <= DUPLICATE_RESTART_WINDOW_MS;
    }

    static boolean isRecentHeartbeat(long heartbeatAtMs, long nowMs) {
        if (heartbeatAtMs <= 0L || nowMs <= 0L) return false;
        long ageMs = nowMs - heartbeatAtMs;
        return ageMs >= -PACKAGE_RESTART_MAX_FUTURE_SKEW_MS
                && ageMs <= PACKAGE_RESTART_HEARTBEAT_MAX_AGE_MS;
    }
}
