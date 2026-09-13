package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiverV121 extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean auto = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE)
                .getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        if (!auto) return;

        SystemLogStore.info(context, "BOOT", "BOOT_COMPLETED • autostart v1.2.1");
        Intent service = new Intent(context, AdBlockVpnServiceV121.class)
                .setAction(AdBlockVpnServiceV121.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (Exception e) {
            SystemLogStore.error(context, "BOOT", "Autostart VPN nieudany", e);
        }
    }
}
