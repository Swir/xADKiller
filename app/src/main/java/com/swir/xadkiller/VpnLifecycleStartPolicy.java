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

    static boolean isDuplicateRestart(String action, String lastAction, long lastAttemptAtMs, long nowMs) {
        if (!isManagedRestartAction(action) || !action.equals(lastAction)) return false;
        if (lastAttemptAtMs <= 0L || nowMs <= 0L) return false;
        long ageMs = nowMs - lastAttemptAtMs;
        return ageMs >= 0L && ageMs <= DUPLICATE_RESTART_WINDOW_MS;
    }

    static boolean isRecentHeartbeat(long heartbeatAtMs, long nowMs) {
        if (heartbeatAtMs <= 0L || nowMs <= 0L) return false;
        long ageMs = nowMs - heartbeatAtMs;
        return ageMs >= -PACKAGE_RESTART_MAX_FUTURE_SKEW_MS
                && ageMs <= PACKAGE_RESTART_HEARTBEAT_MAX_AGE_MS;
    }
}
