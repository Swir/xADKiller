package com.swir.xadkiller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean auto = context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE)
                .getBoolean(BlocklistManager.KEY_AUTOSTART, true);
        if (!auto) return;

        if (VpnService.prepare(context) == null) {
            Intent service = new Intent(context, AdBlockVpnService.class).setAction(AdBlockVpnService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service);
            else context.startService(service);
        }
    }
}
