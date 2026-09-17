package com.swir.xadkiller;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class DnsPrivacyDiagnosticsTest {
    @Test
    public void strictHostnameModeIsARealLocalDnsConflictRisk() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "hostname", "dns.example", true, "dns.example", 2);
        assertEquals(DnsPrivacyDiagnostics.Severity.WARNING, a.severity);
        assertEquals("strict_private_dns", a.code);
        assertTrue(a.localDnsConflict);
        assertTrue(a.encryptedSystemDnsActive);
        assertFalse(a.applicationDohDetectable);
    }

    @Test
    public void unknownModeWithSpecifierIsAlsoTreatedAsStrict() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "unknown", "dns.example", false, "", 1);
        assertEquals("strict_private_dns", a.code);
        assertTrue(a.localDnsConflict);
    }

    @Test
    public void automaticActivePrivateDnsIsNoticeNotFabricatedHardFailure() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "opportunistic", "", true, "resolver.example", 2);
        assertEquals(DnsPrivacyDiagnostics.Severity.NOTICE, a.severity);
        assertEquals("encrypted_system_dns", a.code);
        assertFalse(a.localDnsConflict);
        assertTrue(a.encryptedSystemDnsActive);
    }

    @Test
    public void privateDnsOffIsHealthySystemDnsPath() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "off", "", false, "", 2);
        assertEquals(DnsPrivacyDiagnostics.Severity.OK, a.severity);
        assertEquals("private_dns_off", a.code);
        assertFalse(a.localDnsConflict);
        assertFalse(a.encryptedSystemDnsActive);
    }

    @Test
    public void noNetworkDoesNotPretendToDiagnoseDns() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                false, "off", "", false, "", 0);
        assertEquals(DnsPrivacyDiagnostics.Severity.NOTICE, a.severity);
        assertEquals("no_network", a.code);
        assertFalse(a.localDnsConflict);
    }

    @Test
    public void summariesExplicitlyStateAppDohIsNotDetectable() {
        DnsPrivacyDiagnostics.Assessment strict = DnsPrivacyDiagnostics.assess(
                true, "hostname", "dns.example", true, "dns.example", 2);
        assertTrue(strict.summary(false).contains("app DoH: not detectable"));
        assertTrue(strict.summary(true).contains("DoH aplikacji: niewykrywalny"));
    }
}
