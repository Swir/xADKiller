package com.swir.xadkiller;

/** Pure lifecycle policy kept separate from BroadcastReceiver plumbing so restart behavior is testable. */
final class VpnLifecycleStartPolicy {
    static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    static final String ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";

    private VpnLifecycleStartPolicy() {}

    static boolean shouldStart(String action, boolean autoStartEnabled, boolean wasRunningBeforeRestart) {
        if (action == null) return false;

        // Device boot follows the explicit autostart preference. A package replacement is
        // different: Android has just killed our process while the user may have manually
        // enabled protection. Resume only that previously-running session, even when the
        // user intentionally disabled boot autostart. This preserves both preferences:
        // "do not start at boot" and "do not silently turn protection off after an update".
        if (ACTION_BOOT_COMPLETED.equals(action)) return autoStartEnabled;
        if (ACTION_MY_PACKAGE_REPLACED.equals(action)) return wasRunningBeforeRestart;
        return false;
    }
}
