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
        final boolean strictResolverMismatch;

        Assessment(Severity severity, String code, boolean localDnsConflict,
                   boolean encryptedSystemDnsActive, boolean applicationDohDetectable,
                   boolean strictResolverMismatch) {
            this.severity = severity;
            this.code = code;
            this.localDnsConflict = localDnsConflict;
            this.encryptedSystemDnsActive = encryptedSystemDnsActive;
            this.applicationDohDetectable = applicationDohDetectable;
            this.strictResolverMismatch = strictResolverMismatch;
        }

        String summary(boolean polish) {
            if ("no_network".equals(code)) {
                return polish
                        ? "Brak aktywnej sieci • diagnostyka DNS ograniczona • DoH aplikacji: niewykrywalny"
                        : "No active network • DNS diagnostics limited • app DoH: not detectable";
            }
            if ("strict_private_dns_pending".equals(code)) {
                return polish
                        ? "STRICT Private DNS skonfigurowany, ale nieaktywny • możliwa awaria rozwiązywania nazw • DoH aplikacji: niewykrywalny"
                        : "STRICT Private DNS configured but inactive • name resolution may fail • app DoH: not detectable";
            }
            if ("strict_private_dns_mismatch".equals(code)) {
                return polish
                        ? "STRICT Private DNS • aktywny resolver nie zgadza się z konfiguracją • możliwe przełączanie lub błąd OEM • DoH aplikacji: niewykrywalny"
                        : "STRICT Private DNS • active resolver differs from configured hostname • handover or OEM state may be stale • app DoH: not detectable";
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
            if ("no_dns_servers".equals(code)) {
                return polish
                        ? "Android nie raportuje obecnie serwerów DNS • możliwe przełączenie sieci lub portal logowania • DoH aplikacji: niewykrywalny"
                        : "Android currently reports no DNS servers • network handover or captive portal may be in progress • app DoH: not detectable";
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
        String normalizedSpecifier = normalizeHostname(specifier);
        String normalizedServer = normalizeHostname(privateDnsServerName);

        if (!networkAvailable) {
            return assessment(Severity.NOTICE, "no_network", false, false, false);
        }

        boolean strict = "hostname".equals(normalizedMode)
                || (!normalizedSpecifier.isEmpty()
                    && (normalizedMode.isEmpty() || "unknown".equals(normalizedMode)));
        boolean encryptedEstablished = privateDnsActive || !normalizedServer.isEmpty();
        if (strict) {
            if (!encryptedEstablished) {
                // A configured STRICT resolver that Android has not established is more actionable
                // than a generic conflict warning: DNS may be unavailable until the resolver works.
                return assessment(Severity.WARNING, "strict_private_dns_pending", true, false, false);
            }
            if (!normalizedSpecifier.isEmpty()
                    && !normalizedServer.isEmpty()
                    && !normalizedSpecifier.equals(normalizedServer)) {
                // During network handover or on buggy OEM builds the Settings provider and
                // LinkProperties can temporarily disagree. Do not silently claim that STRICT DNS
                // is healthy when Android says a different resolver is actually active.
                return assessment(Severity.WARNING, "strict_private_dns_mismatch", true, true, true);
            }
            return assessment(Severity.WARNING, "strict_private_dns", true, true, false);
        }

        if (encryptedEstablished) {
            return assessment(Severity.NOTICE, "encrypted_system_dns", false, true, false);
        }

        // OEMs and transient handovers can briefly expose an empty LinkProperties DNS list.
        // Treat it as a notice rather than a hard failure, but surface it instead of claiming the
        // local DNS path is healthy when Android currently reports no resolver at all.
        if (dnsServerCount <= 0) {
            return assessment(Severity.NOTICE, "no_dns_servers", false, false, false);
        }

        if ("off".equals(normalizedMode)) {
            return assessment(Severity.OK, "private_dns_off", false, false, false);
        }

        return assessment(Severity.NOTICE, "private_dns_auto_or_unknown", false, false, false);
    }

    static boolean isPolishLocale() {
        return "pl".equalsIgnoreCase(Locale.getDefault().getLanguage());
    }

    private static Assessment assessment(Severity severity, String code, boolean localDnsConflict,
                                         boolean encryptedSystemDnsActive, boolean mismatch) {
        return new Assessment(severity, code, localDnsConflict, encryptedSystemDnsActive, false, mismatch);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeHostname(String value) {
        String normalized = normalize(value);
        while (normalized.endsWith(".")) normalized = normalized.substring(0, normalized.length() - 1);
        return normalized;
    }
}
