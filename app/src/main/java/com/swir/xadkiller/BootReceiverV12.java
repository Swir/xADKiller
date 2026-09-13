package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiverV12 extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean auto = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE).getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        if (!auto) return;
        SystemLogStore.info(context, "BOOT", "BOOT_COMPLETED • próba automatycznego startu");
        Intent service = new Intent(context, AdBlockVpnServiceV12.class).setAction(AdBlockVpnServiceV12.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service); else context.startService(service);
        } catch (Exception e) {
            SystemLogStore.error(context, "BOOT", "Autostart VPN nieudany", e);
        }
    }
}
