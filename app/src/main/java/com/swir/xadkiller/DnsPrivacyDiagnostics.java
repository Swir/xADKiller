package com.swir.xadkiller;

import java.util.Locale;

/**
 * Pure, testable classification of DNS privacy states that can affect a local DNS-filtering VPN.
 *
 * <p>This deliberately does not claim to detect application-level DoH. Android's system network
 * APIs expose system Private DNS state, but an individual app can use its own encrypted resolver
 * without exposing that fact through LinkProperties.</p>
 */
final class DnsPrivacyDiagnostics {
    enum Severity { OK, NOTICE, WARNING }

    static final class Assessment {
        final Severity severity;
        final String code;
        final boolean localDnsConflict;
        final boolean encryptedSystemDnsActive;
        final boolean applicationDohDetectable;

        Assessment(Severity severity, String code, boolean localDnsConflict,
                   boolean encryptedSystemDnsActive, boolean applicationDohDetectable) {
            this.severity = severity;
            this.code = code;
            this.localDnsConflict = localDnsConflict;
            this.encryptedSystemDnsActive = encryptedSystemDnsActive;
            this.applicationDohDetectable = applicationDohDetectable;
        }

        String summary(boolean polish) {
            if ("no_network".equals(code)) {
                return polish
                        ? "Brak aktywnej sieci • diagnostyka DNS ograniczona • DoH aplikacji: niewykrywalny"
                        : "No active network • DNS diagnostics limited • app DoH: not detectable";
            }
            if ("strict_private_dns".equals(code)) {
                return polish
                        ? "STRICT Private DNS • możliwy konflikt z lokalnym filtrem DNS • DoH aplikacji: niewykrywalny"
                        : "STRICT Private DNS • possible local DNS filter conflict • app DoH: not detectable";
            }
            if ("encrypted_system_dns".equals(code)) {
                return polish
                        ? "Prywatny DNS aktywny • szyfrowany DNS może ominąć lokalny filtr DNS • DoH aplikacji: niewykrywalny"
                        : "Private DNS active • encrypted DNS may bypass the local DNS filter • app DoH: not detectable";
            }
            if ("private_dns_off".equals(code)) {
                return polish
                        ? "Prywatny DNS wyłączony • lokalna ścieżka DNS dostępna • DoH aplikacji: niewykrywalny"
                        : "Private DNS off • local DNS path available • app DoH: not detectable";
            }
            return polish
                    ? "Prywatny DNS automatyczny/nieznany • monitoruj zgodność • DoH aplikacji: niewykrywalny"
                    : "Private DNS automatic/unknown • monitor compatibility • app DoH: not detectable";
        }
    }

    private DnsPrivacyDiagnostics() {}

    static Assessment assess(boolean networkAvailable, String mode, String specifier,
                             boolean privateDnsActive, String privateDnsServerName,
                             int dnsServerCount) {
        String normalizedMode = normalize(mode);
        String normalizedSpecifier = normalize(specifier);
        String normalizedServer = normalize(privateDnsServerName);

        if (!networkAvailable) {
            return new Assessment(Severity.NOTICE, "no_network", false, false, false);
        }

        boolean strict = "hostname".equals(normalizedMode)
                || (!normalizedSpecifier.isEmpty()
                    && (normalizedMode.isEmpty() || "unknown".equals(normalizedMode)));
        if (strict) {
            return new Assessment(Severity.WARNING, "strict_private_dns", true,
                    privateDnsActive || !normalizedServer.isEmpty(), false);
        }

        if (privateDnsActive || !normalizedServer.isEmpty()) {
            return new Assessment(Severity.NOTICE, "encrypted_system_dns", false, true, false);
        }

        if ("off".equals(normalizedMode)) {
            return new Assessment(Severity.OK, "private_dns_off", false, false, false);
        }

        // A zero DNS-server count is intentionally not treated as a hard failure: OEMs and
        // transient network handovers can temporarily report an empty list.
        return new Assessment(Severity.NOTICE, "private_dns_auto_or_unknown", false, false, false);
    }

    static boolean isPolishLocale() {
        return "pl".equalsIgnoreCase(Locale.getDefault().getLanguage());
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
