package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiverV121 extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        SharedPreferences prefs = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
        boolean auto = prefs.getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        boolean wasRunning = prefs.getBoolean("running", false);
        String action = intent.getAction();
        if (!VpnLifecycleStartPolicy.shouldStart(action, auto, wasRunning)) return;

        // Process death during a package update can leave the persisted heartbeat/running
        // flag looking alive for a few seconds. Clear it before requesting the fresh
        // foreground service so the UI never mistakes stale pre-update state for a new VPN.
        prefs.edit()
                .putBoolean("running", false)
                .putLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0)
                .apply();

        String reason = VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED.equals(action)
                ? "MY_PACKAGE_REPLACED • resume previously-running protection"
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
