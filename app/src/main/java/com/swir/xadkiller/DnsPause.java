package com.swir.xadkiller;

import android.content.Context;
import android.content.SharedPreferences;

/** DNS-only pause: keep the tunnel and DNS forwarding alive, expire without alarms. */
final class DnsPause {
    static final String KEY_UNTIL = "dns_pause_until";
    static final long MAX_MS = 15 * 60_000L;

    private DnsPause() {}

    static long remaining(long now, long until) {
        // A clock rollback or damaged preference must never disable filtering indefinitely.
        if (now < 0 || until <= now || until - now > MAX_MS) return 0;
        return until - now;
    }

    static long remaining(Context context) {
        return remaining(System.currentTimeMillis(), prefs(context).getLong(KEY_UNTIL, 0));
    }

    static void pause(Context context, int minutes) {
        long duration = Math.max(0L, Math.min(MAX_MS, minutes * 60_000L));
        prefs(context).edit().putLong(KEY_UNTIL,
                duration == 0 ? 0 : System.currentTimeMillis() + duration).apply();
    }

    static void resume(Context context) {
        prefs(context).edit().remove(KEY_UNTIL).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(BlocklistManager.PREFS, Context.MODE_PRIVATE);
    }
}
