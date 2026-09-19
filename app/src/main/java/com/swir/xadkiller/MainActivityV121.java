package com.swir.xadkiller;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.DateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * v1.6 launcher shell.
 *
 * Keeps the mature v1.4 dashboard implementation while adding the v1.6 system-health
 * and context-aware recovery surface required by the v1.6 roadmap. The health panel
 * is intentionally read-only except for one explicit recovery action; it never turns
 * protection off, deletes user rules or silently changes Private DNS/Accessibility.
 */
public class MainActivityV121 extends MainActivityV140 {
    private static final int REQ_VPN_RECOVERY = 4101;
    private static final int REQ_NOTIFICATIONS_RECOVERY = 4102;
    private static final long REFRESH_MS = 3_000L;

    private final Handler healthHandler = new Handler(Looper.getMainLooper());
    private final Runnable healthRefresh = new Runnable() {
        @Override public void run() {
            refreshHealthPanel();
            healthHandler.postDelayed(this, REFRESH_MS);
        }
    };

    private TextView healthSummary;
    private TextView healthVpn;
    private TextView healthDns;
    private TextView healthBlocklist;
    private TextView healthSmart;
    private TextView healthUpdate;
    private Button recoveryButton;
    private DashboardStatusModel currentHealth;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        installHealthPanel();
        refreshDevelopmentLabels();
        refreshHealthPanel();
    }

    @Override protected void onStart() {
        super.onStart();
        refreshHealthPanel();
    }

    @Override protected void onResume() {
        super.onResume();
        healthHandler.removeCallbacks(healthRefresh);
        healthHandler.post(healthRefresh);
    }

    @Override protected void onPause() {
        healthHandler.removeCallbacks(healthRefresh);
        super.onPause();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_VPN_RECOVERY && resultCode == RESULT_OK) {
            startVpnFromRecovery();
        }
    }

    private void installHealthPanel() {
        View content = findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return;
        ViewGroup contentGroup = (ViewGroup) content;
        if (contentGroup.getChildCount() == 0) return;

        View first = contentGroup.getChildAt(0);
        if (!(first instanceof ScrollView)) return;
        ScrollView scroll = (ScrollView) first;
        if (scroll.getChildCount() == 0 || !(scroll.getChildAt(0) instanceof LinearLayout)) return;
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);

        int surface = getColor(R.color.swir_surface);
        int blue = getColor(R.color.swir_blue);
        int text = getColor(R.color.swir_text);
        int muted = getColor(R.color.swir_muted);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp16(14), dp16(12), dp16(14), dp16(12));
        panel.setBackground(roundRect(surface, 18));

        TextView title = statusText(tr("STAN SYSTEMU • v1.6", "SYSTEM HEALTH • v1.6"), 11, muted, true);
        title.setLetterSpacing(.09f);
        panel.addView(title);

        healthSummary = statusText(tr("Sprawdzanie…", "Checking…"), 17, blue, true);
        panel.addView(healthSummary);
        addGap(panel, 6);

        healthVpn = statusText("", 12, text, true);
        healthDns = statusText("", 12, text, false);
        healthBlocklist = statusText("", 12, text, false);
        healthSmart = statusText("", 12, text, false);
        healthUpdate = statusText("", 12, text, false);
        panel.addView(healthVpn);
        panel.addView(healthDns);
        panel.addView(healthBlocklist);
        panel.addView(healthSmart);
        panel.addView(healthUpdate);
        addGap(panel, 8);

        recoveryButton = new Button(this);
        recoveryButton.setAllCaps(false);
        recoveryButton.setTextSize(12);
        recoveryButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        recoveryButton.setTextColor(Color.BLACK);
        recoveryButton.setBackground(roundRect(blue, 12));
        recoveryButton.setOnClickListener(v -> performRecovery());
        panel.addView(recoveryButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp16(46)));

        TextView note = statusText(
                tr("Recovery nie usuwa własnych reguł i nie zmienia ustawień systemowych bez potwierdzenia.",
                   "Recovery never deletes custom rules or changes system settings without confirmation."),
                10, muted, false);
        note.setGravity(Gravity.CENTER_HORIZONTAL);
        addGap(panel, 5);
        panel.addView(note);

        LinearLayout.LayoutParams panelParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        panelParams.setMargins(0, 0, 0, dp16(9));

        int insertAt = Math.min(2, root.getChildCount());
        root.addView(panel, insertAt, panelParams);
    }

    private void refreshHealthPanel() {
        if (healthSummary == null) return;

        long now = System.currentTimeMillis();
        SharedPreferences p = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE);
        boolean vpnRequested = p.getBoolean("running", false);
        long vpnHeartbeat = p.getLong(AdBlockVpnServiceV121.KEY_HEARTBEAT, 0L);
        boolean smartService = smartServiceEnabled();
        boolean smartDetector = p.getBoolean(SmartAdAccessibilityService.KEY_SMART_ENABLED, true);
        long smartHeartbeat = p.getLong(SmartAdAccessibilityService.KEY_HEARTBEAT, 0L);
        long lastUpdate = p.getLong(BlocklistManager.KEY_LAST_UPDATE, 0L);
        PrivateDnsHelper.Snapshot dns = PrivateDnsHelper.inspect(this);

        currentHealth = DashboardStatusModel.evaluate(
                now,
                vpnRequested,
                vpnHeartbeat,
                dns.networkAvailable,
                dns.isStrict(),
                BlocklistManager.currentCount(),
                BlocklistManager.isFullLoaded(),
                lastUpdate,
                smartService,
                smartDetector,
                smartHeartbeat);

        int good = getColor(R.color.swir_green);
        int warn = getColor(R.color.swir_blue);
        int bad = getColor(R.color.swir_red);
        int muted = getColor(R.color.swir_muted);

        healthSummary.setText(tr(
                "Zdrowe moduły: " + currentHealth.healthyCount + "/5",
                "Healthy modules: " + currentHealth.healthyCount + "/5"));
        healthSummary.setTextColor(currentHealth.healthyCount >= 5 ? good
                : currentHealth.healthyCount >= 3 ? warn : bad);

        switch (currentHealth.vpn) {
            case ACTIVE:
                setLine(healthVpn, tr("VPN: AKTYWNY", "VPN: ACTIVE"), good);
                break;
            case STALE:
                setLine(healthVpn, tr("VPN: stan nieaktualny — recovery dostępne", "VPN: stale state — recovery available"), bad);
                break;
            default:
                setLine(healthVpn, tr("VPN: WYŁĄCZONY", "VPN: OFF"), bad);
        }

        switch (currentHealth.dns) {
            case READY:
                setLine(healthDns, tr("DNS: gotowy • " + dns.pretty(), "DNS: ready • " + dns.pretty()), good);
                break;
            case STRICT_CONFLICT:
                setLine(healthDns, tr("DNS: konflikt STRICT Private DNS", "DNS: STRICT Private DNS conflict"), bad);
                break;
            default:
                setLine(healthDns, tr("DNS: brak aktywnej sieci / handover", "DNS: no active network / handover"), warn);
        }

        switch (currentHealth.blocklist) {
            case READY:
                setLine(healthBlocklist,
                        tr("Listy: gotowe • " + BlocklistManager.currentCount() + " domen",
                           "Lists: ready • " + BlocklistManager.currentCount() + " domains"), good);
                break;
            case STARTER_ONLY:
                setLine(healthBlocklist,
                        tr("Listy: tryb startowy • " + BlocklistManager.currentCount() + " domen",
                           "Lists: starter mode • " + BlocklistManager.currentCount() + " domains"), warn);
                break;
            default:
                setLine(healthBlocklist, tr("Listy: puste — recovery wymagane", "Lists: empty — recovery required"), bad);
        }

        switch (currentHealth.smart) {
            case LIVE:
                setLine(healthSmart, tr("Smart Engine: AKTYWNY", "Smart Engine: ACTIVE"), good);
                break;
            case WAITING:
                setLine(healthSmart, tr("Smart Engine: włączony • oczekuje", "Smart Engine: enabled • waiting"), warn);
                break;
            case DETECTOR_OFF:
                setLine(healthSmart, tr("Smart Engine: wykrywanie wyłączone przez użytkownika", "Smart Engine: detection disabled by user"), muted);
                break;
            default:
                setLine(healthSmart, tr("Smart Engine: Accessibility wyłączone", "Smart Engine: Accessibility disabled"), warn);
        }

        if (lastUpdate <= 0L) {
            setLine(healthUpdate, tr("Ostatnia aktualizacja: tylko lista startowa", "Last update: starter list only"), warn);
        } else {
            String when = DateFormat.getDateTimeInstance(
                    DateFormat.SHORT, DateFormat.SHORT, Locale.getDefault()).format(new Date(lastUpdate));
            int updateColor = currentHealth.update == DashboardStatusModel.UpdateState.FRESH ? good : warn;
            setLine(healthUpdate, tr("Ostatnia aktualizacja: ", "Last update: ") + when, updateColor);
        }

        recoveryButton.setText(recoveryLabel(currentHealth.recovery));
        recoveryButton.setEnabled(true);
        recoveryButton.setAlpha(1.0f);
    }

    private void performRecovery() {
        DashboardStatusModel model = currentHealth;
        if (model == null) {
            refreshHealthPanel();
            return;
        }
        switch (model.recovery) {
            case OPEN_PRIVATE_DNS:
                try {
                    startActivity(PrivateDnsHelper.settingsIntent());
                } catch (Exception e) {
                    Toast.makeText(this, tr("Nie można otworzyć ustawień DNS.", "Cannot open DNS settings."), Toast.LENGTH_LONG).show();
                }
                break;
            case START_VPN:
                prepareVpnRecovery();
                break;
            case UPDATE_BLOCKLIST:
                updateBlocklistRecovery();
                break;
            case OPEN_ACCESSIBILITY:
                try {
                    startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                } catch (Exception e) {
                    Toast.makeText(this, tr("Nie można otworzyć ustawień Accessibility.", "Cannot open Accessibility settings."), Toast.LENGTH_LONG).show();
                }
                break;
            default:
                refreshHealthPanel();
                Toast.makeText(this, tr("Stan odświeżony.", "Status refreshed."), Toast.LENGTH_SHORT).show();
        }
    }

    private void prepareVpnRecovery() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS_RECOVERY);
        }
        Intent permission = VpnService.prepare(this);
        if (permission != null) {
            startActivityForResult(permission, REQ_VPN_RECOVERY);
        } else {
            startVpnFromRecovery();
        }
    }

    private void startVpnFromRecovery() {
        try {
            Intent intent = new Intent(this, AdBlockVpnServiceV121.class)
                    .setAction(AdBlockVpnServiceV121.ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
            else startService(intent);
            Toast.makeText(this, tr("Uruchamiam ochronę…", "Starting protection…"), Toast.LENGTH_SHORT).show();
            healthHandler.postDelayed(this::refreshHealthPanel, 1_000L);
        } catch (Exception e) {
            SystemLogStore.error(this, "UI_RECOVERY", "VPN recovery start failed", e);
            Toast.makeText(this, tr("Recovery VPN nie powiodło się.", "VPN recovery failed."), Toast.LENGTH_LONG).show();
        }
    }

    private void updateBlocklistRecovery() {
        if (recoveryButton == null || !recoveryButton.isEnabled()) return;
        recoveryButton.setEnabled(false);
        recoveryButton.setAlpha(.65f);
        recoveryButton.setText(tr("Aktualizuję listy…", "Updating lists…"));

        new Thread(() -> {
            try {
                int count = BlocklistManager.updateRemote(getApplicationContext());
                SharedPreferences p = getSharedPreferences(BlocklistManager.PREFS, MODE_PRIVATE);
                if (p.getBoolean("running", false)) {
                    try {
                        startService(new Intent(this, AdBlockVpnServiceV121.class)
                                .setAction(AdBlockVpnServiceV121.ACTION_RELOAD));
                    } catch (Exception reloadError) {
                        SystemLogStore.error(this, "UI_RECOVERY", "VPN reload after list recovery failed", reloadError);
                    }
                }
                SystemLogStore.info(this, "UI_RECOVERY", "Blocklist recovery OK • " + count);
                runOnUiThread(() -> {
                    refreshHealthPanel();
                    Toast.makeText(this,
                            tr("Listy ochrony odświeżone.", "Protection lists refreshed."),
                            Toast.LENGTH_SHORT).show();
                });
            } catch (Throwable error) {
                SystemLogStore.error(this, "UI_RECOVERY", "Blocklist recovery failed", error);
                runOnUiThread(() -> {
                    refreshHealthPanel();
                    Toast.makeText(this,
                            tr("Aktualizacja list nie powiodła się — zachowano znaną dobrą kopię.",
                               "List update failed — known-good copy was preserved."),
                            Toast.LENGTH_LONG).show();
                });
            }
        }, "xADKiller-V160-Recovery").start();
    }

    private boolean smartServiceEnabled() {
        try {
            AccessibilityManager manager = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
            if (manager == null || !manager.isEnabled()) return false;
            List<AccessibilityServiceInfo> list = manager.getEnabledAccessibilityServiceList(
                    AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            for (AccessibilityServiceInfo info : list) {
                if (info == null || info.getResolveInfo() == null || info.getResolveInfo().serviceInfo == null) continue;
                ServiceInfo service = info.getResolveInfo().serviceInfo;
                if (getPackageName().equals(service.packageName)
                        && service.name != null
                        && service.name.endsWith("SmartAdAccessibilityService")) {
                    return true;
                }
            }
        } catch (Throwable error) {
            SystemLogStore.error(this, "UI_RECOVERY", "Smart Engine state read failed", error);
        }
        return false;
    }

    private void refreshDevelopmentLabels() {
        View root = findViewById(android.R.id.content);
        replaceVersionLabel(root);
    }

    private void replaceVersionLabel(View view) {
        if (view == null) return;
        if (view instanceof TextView) {
            TextView textView = (TextView) view;
            CharSequence text = textView.getText();
            if (text != null && text.toString().startsWith("xADKiller 1.5.0")) {
                textView.setText(text.toString().replace("xADKiller 1.5.0", "xADKiller 1.6.0-dev"));
            }
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) replaceVersionLabel(group.getChildAt(i));
        }
    }

    private String recoveryLabel(DashboardStatusModel.RecoveryAction action) {
        switch (action) {
            case OPEN_PRIVATE_DNS:
                return tr("NAPRAW: USTAWIENIA PRIVATE DNS", "FIX: PRIVATE DNS SETTINGS");
            case START_VPN:
                return tr("NAPRAW: URUCHOM VPN", "FIX: START VPN");
            case UPDATE_BLOCKLIST:
                return tr("NAPRAW: ODŚWIEŻ LISTY", "FIX: REFRESH LISTS");
            case OPEN_ACCESSIBILITY:
                return tr("NAPRAW: WŁĄCZ SMART ENGINE", "FIX: ENABLE SMART ENGINE");
            default:
                return tr("ODŚWIEŻ STAN", "REFRESH STATUS");
        }
    }

    private String tr(String pl, String en) {
        String language = I18n.language(this);
        return "pl".equalsIgnoreCase(language) ? pl : en;
    }

    private void setLine(TextView view, String text, int color) {
        if (view == null) return;
        view.setText(text);
        view.setTextColor(color);
    }

    private TextView statusText(String text, float sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.08f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp16(radiusDp));
        return drawable;
    }

    private void addGap(LinearLayout parent, int dp) {
        View gap = new View(this);
        parent.addView(gap, new LinearLayout.LayoutParams(1, dp16(dp)));
    }

    private int dp16(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
