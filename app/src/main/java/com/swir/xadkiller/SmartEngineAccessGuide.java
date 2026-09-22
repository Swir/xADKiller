package com.swir.xadkiller;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import android.widget.Toast;

import java.util.List;

/**
 * Safe user-facing recovery for Smart Ad Engine Accessibility enablement.
 *
 * Android 13+ may gray out sideloaded accessibility services behind the platform's
 * "restricted settings" protection. Apps cannot bypass that protection. This guide
 * gives the owner an explicit route to App info and Accessibility without changing
 * any system setting on their behalf.
 */
final class SmartEngineAccessGuide {
    private SmartEngineAccessGuide() {}

    static boolean shouldOfferRestrictedSettingsHelp(int sdkInt, boolean serviceEnabled) {
        return sdkInt >= 33 && !serviceEnabled;
    }

    static boolean isServiceEnabled(Context context) {
        try {
            AccessibilityManager manager =
                    (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (manager == null || !manager.isEnabled()) return false;

            List<AccessibilityServiceInfo> services =
                    manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            for (AccessibilityServiceInfo info : services) {
                if (info == null || info.getResolveInfo() == null
                        || info.getResolveInfo().serviceInfo == null) continue;
                ServiceInfo service = info.getResolveInfo().serviceInfo;
                if (context.getPackageName().equals(service.packageName)
                        && service.name != null
                        && service.name.endsWith("SmartAdAccessibilityService")) {
                    return true;
                }
            }
        } catch (Throwable error) {
            SystemLogStore.error(context, "SMART_ACCESS", "Smart Engine state read failed", error);
        }
        return false;
    }

    static void open(Activity activity) {
        boolean enabled = isServiceEnabled(activity);
        if (!shouldOfferRestrictedSettingsHelp(Build.VERSION.SDK_INT, enabled)) {
            openAccessibility(activity);
            return;
        }

        new AlertDialog.Builder(activity)
                .setTitle(tr(activity,
                        "Smart Engine — ograniczony dostęp",
                        "Smart Engine — restricted access"))
                .setMessage(tr(activity,
                        "Jeśli „xADKiller Smart Ad Engine” jest wyszarzony i Android pokazuje ustawienia z ograniczonym dostępem, otwórz „Informacje o aplikacji”, użyj menu ⋮ i wybierz „Zezwól na ustawienia z ograniczonym dostępem”. Potem wróć tutaj i włącz Smart Engine w Ułatwieniach dostępu. xADKiller nie może ominąć tej blokady systemowej.",
                        "If “xADKiller Smart Ad Engine” is grayed out and Android reports restricted settings, open App info, use the ⋮ menu and choose “Allow restricted settings”. Then return here and enable Smart Engine in Accessibility. xADKiller cannot bypass this Android security gate."))
                .setNegativeButton(tr(activity, "ANULUJ", "CANCEL"), null)
                .setNeutralButton(tr(activity, "UŁATWIENIA DOSTĘPU", "ACCESSIBILITY"),
                        (dialog, which) -> openAccessibility(activity))
                .setPositiveButton(tr(activity, "INFO O APLIKACJI", "APP INFO"),
                        (dialog, which) -> openAppInfo(activity))
                .show();
    }

    private static void openAccessibility(Activity activity) {
        try {
            activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } catch (Exception error) {
            SystemLogStore.error(activity, "SMART_ACCESS", "Cannot open Accessibility settings", error);
            Toast.makeText(activity,
                    tr(activity, "Nie można otworzyć Ułatwień dostępu.",
                            "Cannot open Accessibility settings."),
                    Toast.LENGTH_LONG).show();
        }
    }

    private static void openAppInfo(Activity activity) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        } catch (Exception error) {
            SystemLogStore.error(activity, "SMART_ACCESS", "Cannot open app info", error);
            Toast.makeText(activity,
                    tr(activity, "Nie można otworzyć informacji o aplikacji.",
                            "Cannot open app info."),
                    Toast.LENGTH_LONG).show();
        }
    }

    private static String tr(Context context, String pl, String en) {
        return "pl".equalsIgnoreCase(I18n.language(context)) ? pl : en;
    }
}
