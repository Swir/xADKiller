package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.VpnService;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;

public class BootReceiverV121 extends BroadcastReceiver {
    private static final String KEY_LAST_RESTART_ACTION = "vpn_last_restart_action_v160";
    private static final String KEY_LAST_RESTART_ELAPSED = "vpn_last_restart_elapsed_v160";
    private static final String KEY_LAST_RESTART_BOOT_COUNT = "vpn_last_restart_boot_count_v160";

    @Override public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        String action = intent.getAction();
        boolean managedRestart = VpnLifecycleStartPolicy.isManagedRestartAction(action);
        // Intent filters are only routing hints and explicit delivery can bypass them. The
        // receiver is non-exported, but still fail closed in code so future manifest edits
        // cannot accidentally turn an unrelated broadcast into a VPN lifecycle mutation.
        if (!managedRestart) return;

        SharedPreferences prefs = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long nowElapsed = SystemClock.elapsedRealtime();
        int currentBootCount = readBootCount(context);
        String lastRestartAction = prefs.getString(KEY_LAST_RESTART_ACTION, "");
        long lastRestartElapsed = prefs.getLong(KEY_LAST_RESTART_ELAPSED, 0L);
        int lastRestartBootCount = prefs.getInt(KEY_LAST_RESTART_BOOT_COUNT, -1);
        boolean auto = prefs.getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        boolean wasRunning = prefs.getBoolean("running", false);
        long heartbeatAt = prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0L);
        boolean lifecycleAllowsStart = VpnLifecycleStartPolicy.shouldStart(action, auto, wasRunning, heartbeatAt, now);

        // Duplicate suppression uses the monotonic elapsed-realtime clock rather than wall
        // time, and on Android N+ the marker is also bound to Settings.Global.BOOT_COUNT.
        // This prevents a small elapsedRealtime value persisted on the previous boot from
        // looking like a fresh same-boot duplicate when BOOT_COMPLETED arrives later on the
        // next boot. A managed broadcast that is not eligible to start still never occupies
        // the duplicate window.
        if (VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                action, lifecycleAllowsStart, lastRestartAction, lastRestartElapsed, nowElapsed,
                lastRestartBootCount, currentBootCount)) {
            SystemLogStore.info(context, "BOOT", "Pomijam zduplikowany sygnał restartu VPN: " + action);
            return;
        }

        // BOOT_COMPLETED and MY_PACKAGE_REPLACED both imply the old process is gone.
        // Always clear pre-restart liveness before making a start decision, including the
        // "autostart disabled", stale-heartbeat and missing-VPN-consent paths. This prevents
        // the UI from showing a dead pre-reboot/pre-update VPN as active.
        prefs.edit()
                .putBoolean("running", false)
                .putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0)
                .apply();

        boolean vpnConsentGranted = false;
        if (lifecycleAllowsStart) {
            try {
                vpnConsentGranted = VpnService.prepare(context) == null;
            } catch (Exception error) {
                SystemLogStore.error(context, "BOOT", "Nie można potwierdzić zgody VPN przed restartem", error);
            }
        }

        boolean shouldStart = VpnLifecycleStartPolicy.shouldStartWithConsent(
                action, auto, wasRunning, heartbeatAt, now, vpnConsentGranted);

        if (!shouldStart) {
            if (lifecycleAllowsStart && !vpnConsentGranted) {
                SystemLogStore.warn(context, "BOOT", "Pomijam autostart/restart: zgoda VPN nie jest już aktywna");
            } else if (VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED.equals(action) && wasRunning) {
                SystemLogStore.warn(context, "BOOT", "Pomijam wznowienie po aktualizacji: brak świeżego heartbeat aktywnego VPN");
            }
            return;
        }

        // Record only a real, consented start attempt. Rejected lifecycle signals must not
        // poison the duplicate window. The boot generation accompanies elapsedRealtime when
        // available, so persisted markers cannot cross reboot epochs. If Android/OEM rejects
        // startForegroundService below, the marker is removed again for immediate recovery.
        SharedPreferences.Editor restartMarker = prefs.edit()
                .putString(KEY_LAST_RESTART_ACTION, action)
                .putLong(KEY_LAST_RESTART_ELAPSED, nowElapsed);
        if (currentBootCount >= 0) restartMarker.putInt(KEY_LAST_RESTART_BOOT_COUNT, currentBootCount);
        else restartMarker.remove(KEY_LAST_RESTART_BOOT_COUNT);
        restartMarker.apply();

        String reason = VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED.equals(action)
                ? "MY_PACKAGE_REPLACED • resume recent previously-running protection"
                : "BOOT_COMPLETED • autostart";
        SystemLogStore.info(context, "BOOT", reason + " • v1.6.0-dev");

        Intent service = new Intent(context, AdBlockVpnServiceV121.class)
                .setAction(AdBlockVpnServiceV121.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (Exception e) {
            // Keep persisted state truthful if Android/OEM policy rejects the restart, and
            // clear the dedupe marker so the next legitimate managed broadcast may retry.
            prefs.edit()
                    .putBoolean("running", false)
                    .putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0)
                    .remove(KEY_LAST_RESTART_ACTION)
                    .remove(KEY_LAST_RESTART_ELAPSED)
                    .remove(KEY_LAST_RESTART_BOOT_COUNT)
                    .apply();
            SystemLogStore.error(context, "BOOT", "Autostart/restart VPN nieudany", e);
        }
    }

    private static int readBootCount(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return -1;
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Exception ignored) {
            // Older/OEM builds may not expose a readable boot count. In that case the policy
            // falls back to monotonic-clock dedupe rather than blocking lifecycle recovery.
            return -1;
        }
    }
}
