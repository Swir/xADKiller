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
        SystemLogStore.info(this, "APP", "Start procesu xADKiller 1.4.0 • Adaptive AI • Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
    }
}
