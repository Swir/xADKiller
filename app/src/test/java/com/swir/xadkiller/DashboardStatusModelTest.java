package com.swir.xadkiller;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class DashboardStatusModelTest {
    private static final long NOW = 2_000_000_000_000L;

    @Test
    public void healthySnapshotHasNoRecoveryAction() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                125_000, true, NOW - 60_000L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.VpnState.ACTIVE, model.vpn);
        assertEquals(DashboardStatusModel.DnsState.READY, model.dns);
        assertEquals(DashboardStatusModel.BlocklistState.READY, model.blocklist);
        assertEquals(DashboardStatusModel.SmartState.LIVE, model.smart);
        assertEquals(DashboardStatusModel.UpdateState.FRESH, model.update);
        assertEquals(DashboardStatusModel.RecoveryAction.NONE, model.recovery);
        assertEquals(5, model.healthyCount);
    }

    @Test
    public void strictPrivateDnsConflictWinsRecoveryPriority() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, false, 0L, true, true,
                126, false, 0L,
                false, true, 0L);

        assertEquals(DashboardStatusModel.DnsState.STRICT_CONFLICT, model.dns);
        assertEquals(DashboardStatusModel.RecoveryAction.OPEN_PRIVATE_DNS, model.recovery);
    }

    @Test
    public void staleVpnHeartbeatRequestsVpnRecovery() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - DashboardStatusModel.VPN_FRESH_MS - 1L, true, false,
                50_000, true, NOW - 1_000L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.VpnState.STALE, model.vpn);
        assertEquals(DashboardStatusModel.RecoveryAction.START_VPN, model.recovery);
    }

    @Test
    public void futureVpnHeartbeatCannotPretendProtectionIsFresh() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW + 1_000L, true, false,
                50_000, true, NOW - 1_000L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.VpnState.STALE, model.vpn);
        assertEquals(DashboardStatusModel.RecoveryAction.START_VPN, model.recovery);
    }

    @Test
    public void starterListOrNeverUpdatedRequestsSafeListUpdate() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                126, false, 0L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.BlocklistState.STARTER_ONLY, model.blocklist);
        assertEquals(DashboardStatusModel.UpdateState.NEVER, model.update);
        assertEquals(DashboardStatusModel.RecoveryAction.UPDATE_BLOCKLIST, model.recovery);
    }

    @Test
    public void staleFullListRequestsRefreshBeforeAccessibilityRepair() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                125_000, true, NOW - DashboardStatusModel.UPDATE_STALE_MS - 1L,
                false, true, 0L);

        assertEquals(DashboardStatusModel.UpdateState.STALE, model.update);
        assertEquals(DashboardStatusModel.SmartState.SERVICE_OFF, model.smart);
        assertEquals(DashboardStatusModel.RecoveryAction.UPDATE_BLOCKLIST, model.recovery);
    }

    @Test
    public void emptyListRequestsRefreshEvenWithRecentUpdateTimestamp() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                0, false, NOW - 1_000L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.BlocklistState.EMPTY, model.blocklist);
        assertEquals(DashboardStatusModel.RecoveryAction.UPDATE_BLOCKLIST, model.recovery);
    }

    @Test
    public void disabledAccessibilityIsLastRecoveryPriority() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                120_000, true, NOW - 1_000L,
                false, true, 0L);

        assertEquals(DashboardStatusModel.SmartState.SERVICE_OFF, model.smart);
        assertEquals(DashboardStatusModel.RecoveryAction.OPEN_ACCESSIBILITY, model.recovery);
    }

    @Test
    public void intentionalSmartDetectorDisableDoesNotForceAccessibilityRecovery() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                120_000, true, NOW - 1_000L,
                false, false, 0L);

        assertEquals(DashboardStatusModel.SmartState.SERVICE_OFF, model.smart);
        assertEquals(DashboardStatusModel.RecoveryAction.NONE, model.recovery);
    }

    @Test
    public void noNetworkIsVisibleAndCannotCountAsHealthyDns() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, false, false,
                120_000, true, NOW - 1_000L,
                true, true, NOW - 1_000L);

        assertEquals(DashboardStatusModel.DnsState.NO_NETWORK, model.dns);
        assertEquals(DashboardStatusModel.RecoveryAction.NONE, model.recovery);
        assertEquals(4, model.healthyCount);
    }

    @Test
    public void futureUpdateTimestampDoesNotBecomeStaleDuringClockCorrection() {
        DashboardStatusModel model = DashboardStatusModel.evaluate(
                NOW, true, NOW - 1_000L, true, false,
                120_000, true, NOW + 5_000L,
                true, false, 0L);

        assertEquals(DashboardStatusModel.UpdateState.FRESH, model.update);
        assertEquals(DashboardStatusModel.SmartState.DETECTOR_OFF, model.smart);
        assertEquals(DashboardStatusModel.RecoveryAction.NONE, model.recovery);
    }
}
