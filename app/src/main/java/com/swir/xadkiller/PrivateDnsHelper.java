package com.swir.xadkiller;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;
import android.provider.Settings;

import java.util.ArrayList;
import java.util.List;

final class PrivateDnsHelper {
    static final class Snapshot {
        final String mode;
        final String specifier;
        final boolean privateDnsActive;
        final String privateDnsServerName;
        final List<String> dnsServers;
        final boolean networkAvailable;

        Snapshot(String mode, String specifier, boolean privateDnsActive, String privateDnsServerName, List<String> dnsServers, boolean networkAvailable) {
            this.mode = mode == null ? "unknown" : mode;
            this.specifier = specifier == null ? "" : specifier;
            this.privateDnsActive = privateDnsActive;
            this.privateDnsServerName = privateDnsServerName == null ? "" : privateDnsServerName;
            this.dnsServers = dnsServers;
            this.networkAvailable = networkAvailable;
        }

        boolean isStrict() { return "hostname".equalsIgnoreCase(mode) || (!specifier.isEmpty() && "unknown".equals(mode)); }
        String pretty() {
            if (isStrict()) return "Nazwa hosta / STRICT" + (specifier.isEmpty() ? "" : " • " + specifier);
            if ("off".equalsIgnoreCase(mode)) return "Wyłączony";
            if ("opportunistic".equalsIgnoreCase(mode) || "automatic".equalsIgnoreCase(mode)) return "Automatyczny" + (privateDnsActive ? " • aktywny" : "");
            return mode + (privateDnsActive ? " • aktywny" : "");
        }
    }

    private PrivateDnsHelper() {}

    static Snapshot inspect(Context context) {
        String mode = null, specifier = null, serverName = null;
        boolean active = false, networkAvailable = false;
        List<String> dns = new ArrayList<>();
        try { mode = Settings.Global.getString(context.getContentResolver(), "private_dns_mode"); } catch (Exception ignored) {}
        try { specifier = Settings.Global.getString(context.getContentResolver(), "private_dns_specifier"); } catch (Exception ignored) {}
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network network = cm.getActiveNetwork();
                networkAvailable = network != null;
                LinkProperties lp = network == null ? null : cm.getLinkProperties(network);
                if (lp != null) {
                    lp.getDnsServers().forEach(a -> dns.add(a.getHostAddress()));
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        active = lp.isPrivateDnsActive();
                        serverName = lp.getPrivateDnsServerName();
                    }
                }
            }
        } catch (Exception ignored) {}
        return new Snapshot(mode, specifier, active, serverName, dns, networkAvailable);
    }

    static Intent settingsIntent() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return new Intent(Settings.ACTION_PRIVATE_DNS_SETTINGS);
        return new Intent(Settings.ACTION_WIRELESS_SETTINGS);
    }
}
