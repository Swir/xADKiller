package com.swir.xadkiller;

import android.app.Application;
import android.os.Build;

public class XadKillerApp extends Application {
    @Override public void onCreate() {
        super.onCreate();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                SystemLogStore.error(this, "CRASH", "Nieobsłużony wyjątek w wątku " + thread.getName(), throwable);
            } catch (Throwable ignored) {}
            if (previous != null) previous.uncaughtException(thread, throwable);
        });

        // Recover only a previously verified .bak after a process kill/reboot in the tiny
        // cache-install rename window. An interrupted .tmp is deliberately never promoted.
        BlocklistCacheRecovery.recover(this);

        SystemLogStore.info(this, "APP", "Start procesu xADKiller 1.6.0-dev • lokalny VPN/DNS • Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
    }
}
