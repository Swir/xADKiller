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
    public void strictConfiguredButNotEstablishedGetsActionableWarning() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "hostname", "dns.example", false, "", 0);
        assertEquals(DnsPrivacyDiagnostics.Severity.WARNING, a.severity);
        assertEquals("strict_private_dns_pending", a.code);
        assertTrue(a.localDnsConflict);
        assertFalse(a.encryptedSystemDnsActive);
        assertTrue(a.summary(false).contains("configured but inactive"));
        assertTrue(a.summary(true).contains("skonfigurowany, ale nieaktywny"));
    }

    @Test
    public void unknownModeWithSpecifierIsAlsoTreatedAsStrict() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "unknown", "dns.example", true, "dns.example", 1);
        assertEquals("strict_private_dns", a.code);
        assertTrue(a.localDnsConflict);
    }

    @Test
    public void unknownModeWithSpecifierButNoEstablishedResolverIsPendingStrict() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "unknown", "dns.example", false, "", 1);
        assertEquals("strict_private_dns_pending", a.code);
        assertTrue(a.localDnsConflict);
        assertFalse(a.encryptedSystemDnsActive);
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
    public void privateDnsOffIsHealthySystemDnsPathWhenResolversExist() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "off", "", false, "", 2);
        assertEquals(DnsPrivacyDiagnostics.Severity.OK, a.severity);
        assertEquals("private_dns_off", a.code);
        assertFalse(a.localDnsConflict);
        assertFalse(a.encryptedSystemDnsActive);
    }

    @Test
    public void privateDnsOffWithNoReportedResolversIsNoticeNotHealthy() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "off", "", false, "", 0);
        assertEquals(DnsPrivacyDiagnostics.Severity.NOTICE, a.severity);
        assertEquals("no_dns_servers", a.code);
        assertFalse(a.localDnsConflict);
        assertFalse(a.encryptedSystemDnsActive);
    }

    @Test
    public void automaticModeWithNoReportedResolversSurfacesHandoverState() {
        DnsPrivacyDiagnostics.Assessment a = DnsPrivacyDiagnostics.assess(
                true, "opportunistic", "", false, "", 0);
        assertEquals(DnsPrivacyDiagnostics.Severity.NOTICE, a.severity);
        assertEquals("no_dns_servers", a.code);
        assertTrue(a.summary(false).contains("reports no DNS servers"));
        assertTrue(a.summary(true).contains("nie raportuje obecnie serwerów DNS"));
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
        DnsPrivacyDiagnostics.Assessment noResolvers = DnsPrivacyDiagnostics.assess(
                true, "off", "", false, "", 0);
        assertTrue(strict.summary(false).contains("app DoH: not detectable"));
        assertTrue(strict.summary(true).contains("DoH aplikacji: niewykrywalny"));
        assertTrue(noResolvers.summary(false).contains("app DoH: not detectable"));
        assertTrue(noResolvers.summary(true).contains("DoH aplikacji: niewykrywalny"));
    }
}
