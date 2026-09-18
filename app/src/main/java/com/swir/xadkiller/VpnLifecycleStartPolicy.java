package com.swir.xadkiller;

/** Pure lifecycle policy kept separate from BroadcastReceiver plumbing so restart behavior is testable. */
final class VpnLifecycleStartPolicy {
    static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    static final String ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";

    private VpnLifecycleStartPolicy() {}

    static boolean shouldStart(String action, boolean autoStartEnabled, boolean wasRunningBeforeRestart) {
        if (!autoStartEnabled || action == null) return false;
        if (ACTION_BOOT_COMPLETED.equals(action)) return true;
        if (ACTION_MY_PACKAGE_REPLACED.equals(action)) return wasRunningBeforeRestart;
        return false;
    }
}
