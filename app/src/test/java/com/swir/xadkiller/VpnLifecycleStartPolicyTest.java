package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VpnLifecycleStartPolicyTest {
    private static final long NOW = 1_000_000L;

    @Test public void bootStartsOnlyWhenAutostartIsEnabled() {
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true, false, 0L, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, false, true, NOW - 1_000L, NOW));
    }

    @Test public void packageUpdateResumesOnlyRecentlyRunningProtectionEvenWhenBootAutostartIsOff() {
        long freshHeartbeat = NOW - 5_000L;
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true, freshHeartbeat, NOW));
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false, true, freshHeartbeat, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, false, freshHeartbeat, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false, false, freshHeartbeat, NOW));
    }

    @Test public void staleMissingOrImplausiblyFutureHeartbeatCannotResurrectVpnAfterUpdate() {
        long stale = NOW - VpnLifecycleStartPolicy.PACKAGE_RESTART_HEARTBEAT_MAX_AGE_MS - 1L;
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true, stale, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true, 0L, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true, NOW + 31_000L, NOW));
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true, NOW + 30_000L, NOW));
    }

    @Test public void restartActionsAreExplicitlyClassifiedForStaleStateCleanup() {
        assertTrue(VpnLifecycleStartPolicy.isManagedRestartAction(VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED));
        assertTrue(VpnLifecycleStartPolicy.isManagedRestartAction(VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED));
        assertFalse(VpnLifecycleStartPolicy.isManagedRestartAction("android.intent.action.TIME_SET"));
        assertFalse(VpnLifecycleStartPolicy.isManagedRestartAction(null));
    }

    @Test public void unrelatedBroadcastsNeverStartTheVpn() {
        assertFalse(VpnLifecycleStartPolicy.shouldStart("android.intent.action.TIME_SET", true, true, NOW - 1_000L, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(null, true, true, NOW - 1_000L, NOW));
    }
}
