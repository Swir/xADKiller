package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiverV121 extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        String action = intent.getAction();
        boolean managedRestart = VpnLifecycleStartPolicy.isManagedRestartAction(action);
        // Intent filters are only routing hints and explicit delivery can bypass them. The
        // receiver is non-exported, but still fail closed in code so future manifest edits
        // cannot accidentally turn an unrelated broadcast into a VPN lifecycle mutation.
        if (!managedRestart) return;

        SharedPreferences prefs = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        boolean auto = prefs.getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        boolean wasRunning = prefs.getBoolean("running", false);
        long heartbeatAt = prefs.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0L);
        long now = System.currentTimeMillis();
        boolean shouldStart = VpnLifecycleStartPolicy.shouldStart(action, auto, wasRunning, heartbeatAt, now);

        // BOOT_COMPLETED and MY_PACKAGE_REPLACED both imply the old process is gone.
        // Always clear pre-restart liveness before making a start decision, including the
        // "autostart disabled" and stale-heartbeat paths. This prevents the UI from showing
        // a dead pre-reboot/pre-update VPN as active when no replacement service is started.
        prefs.edit()
                .putBoolean("running", false)
                .putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0)
                .apply();

        if (!shouldStart) {
            if (VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED.equals(action) && wasRunning) {
                SystemLogStore.warn(context, "BOOT", "Pomijam wznowienie po aktualizacji: brak świeżego heartbeat aktywnego VPN");
            }
            return;
        }

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
            // Keep persisted state truthful if Android/OEM policy rejects the restart.
            prefs.edit()
                    .putBoolean("running", false)
                    .putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0)
                    .apply();
            SystemLogStore.error(context, "BOOT", "Autostart/restart VPN nieudany", e);
        }
    }
}
