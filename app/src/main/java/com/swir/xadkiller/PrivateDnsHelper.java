package com.swir.xadkiller;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
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
        final boolean captivePortal;
        final boolean validatedInternet;
        final DnsPrivacyDiagnostics.Assessment diagnostics;

        Snapshot(String mode, String specifier, boolean privateDnsActive, String privateDnsServerName,
                 List<String> dnsServers, boolean networkAvailable) {
            this(mode, specifier, privateDnsActive, privateDnsServerName, dnsServers,
                    networkAvailable, false, true);
        }

        Snapshot(String mode, String specifier, boolean privateDnsActive, String privateDnsServerName,
                 List<String> dnsServers, boolean networkAvailable,
                 boolean captivePortal, boolean validatedInternet) {
            this.mode = mode == null ? "unknown" : mode;
            this.specifier = specifier == null ? "" : specifier;
            this.privateDnsActive = privateDnsActive;
            this.privateDnsServerName = privateDnsServerName == null ? "" : privateDnsServerName;
            this.dnsServers = dnsServers;
            this.networkAvailable = networkAvailable;
            this.captivePortal = captivePortal;
            this.validatedInternet = validatedInternet;
            this.diagnostics = DnsPrivacyDiagnostics.assess(
                    networkAvailable,
                    this.mode,
                    this.specifier,
                    privateDnsActive,
                    this.privateDnsServerName,
                    dnsServers == null ? 0 : dnsServers.size(),
                    captivePortal,
                    validatedInternet);
        }

        boolean isStrict() { return diagnostics.localDnsConflict; }

        String pretty() {
            String summary = diagnostics.summary(DnsPrivacyDiagnostics.isPolishLocale());
            String resolver = privateDnsServerName.isEmpty() ? specifier : privateDnsServerName;
            return resolver.isEmpty() ? summary : summary + " • " + resolver;
        }
    }

    private PrivateDnsHelper() {}

    static Snapshot inspect(Context context) {
        String mode = null, specifier = null, serverName = null;
        boolean active = false, networkAvailable = false, captivePortal = false, validatedInternet = false;
        List<String> dns = new ArrayList<>();
        try { mode = Settings.Global.getString(context.getContentResolver(), "private_dns_mode"); } catch (Exception ignored) {}
        try { specifier = Settings.Global.getString(context.getContentResolver(), "private_dns_specifier"); } catch (Exception ignored) {}
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network network = cm.getActiveNetwork();
                networkAvailable = network != null;
                NetworkCapabilities caps = network == null ? null : cm.getNetworkCapabilities(network);
                if (caps != null) {
                    captivePortal = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL);
                    validatedInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                }
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
        return new Snapshot(mode, specifier, active, serverName, dns,
                networkAvailable, captivePortal, validatedInternet);
    }

    static Intent settingsIntent() {
        // The public Settings constant for this screen is not available on every SDK/OEM,
        // while Android still accepts the documented action string on Android 9+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return new Intent("android.settings.PRIVATE_DNS_SETTINGS");
        }
        return new Intent(Settings.ACTION_WIRELESS_SETTINGS);
    }
}
