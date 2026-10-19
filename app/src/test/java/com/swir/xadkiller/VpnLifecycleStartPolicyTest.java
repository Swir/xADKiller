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

    @Test public void restartAlsoRequiresExistingVpnConsent() {
        long freshHeartbeat = NOW - 5_000L;
        assertTrue(VpnLifecycleStartPolicy.shouldStartWithConsent(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true, false, 0L, NOW, true));
        assertFalse(VpnLifecycleStartPolicy.shouldStartWithConsent(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true, false, 0L, NOW, false));
        assertTrue(VpnLifecycleStartPolicy.shouldStartWithConsent(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false, true, freshHeartbeat, NOW, true));
        assertFalse(VpnLifecycleStartPolicy.shouldStartWithConsent(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false, true, freshHeartbeat, NOW, false));
    }

    @Test public void duplicateManagedRestartBurstSuppressesOnlySameActionRepeats() {
        long inside = NOW - VpnLifecycleStartPolicy.DUPLICATE_RESTART_WINDOW_MS + 1L;
        long outside = NOW - VpnLifecycleStartPolicy.DUPLICATE_RESTART_WINDOW_MS - 1L;
        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, inside, NOW));
        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, inside, NOW));

        // A different lifecycle action can represent a real second process kill. It must not
        // be swallowed by the dedupe window or protection may stay down after a boot/update race.
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, inside, NOW));
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, inside, NOW));

        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                NOW - VpnLifecycleStartPolicy.DUPLICATE_RESTART_WINDOW_MS, NOW));
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, outside, NOW));
    }

    @Test public void rejectedLifecycleSignalAndCrossActionEventDoNotPoisonLaterLegitimateStart() {
        long inside = NOW - 1_000L;
        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, inside, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, false,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, inside, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, inside, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, inside, NOW));
        assertTrue(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, inside, NOW));
        assertTrue(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, inside, NOW));
    }

    @Test public void elapsedRealtimeResetOrRollbackDoesNotSuppressFirstRestartAfterReboot() {
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, NOW + 1L, NOW));
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, NOW, 0L));
    }

    @Test public void restartActionsAreExplicitlyClassifiedForStaleStateCleanup() {
        assertTrue(VpnLifecycleStartPolicy.isManagedRestartAction(VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED));
        assertTrue(VpnLifecycleStartPolicy.isManagedRestartAction(VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED));
        assertFalse(VpnLifecycleStartPolicy.isManagedRestartAction("android.intent.action.TIME_SET"));
        assertFalse(VpnLifecycleStartPolicy.isManagedRestartAction(null));
    }

    @Test public void unrelatedOrLookalikeBroadcastsNeverStartTheVpn() {
        String[] rejected = {
                "android.intent.action.TIME_SET",
                "android.intent.action.PACKAGE_REPLACED",
                "android.intent.action.LOCKED_BOOT_COMPLETED",
                "com.swir.xadkiller.v121.START",
                "android.intent.action.MY_PACKAGE_REPLACED.fake"
        };
        for (String action : rejected) {
            assertFalse(VpnLifecycleStartPolicy.isManagedRestartAction(action));
            assertFalse(VpnLifecycleStartPolicy.shouldStart(action, true, true, NOW - 1_000L, NOW));
            assertFalse(VpnLifecycleStartPolicy.shouldStartWithConsent(action, true, true, NOW - 1_000L, NOW, true));
            assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(action, action, NOW - 1_000L, NOW));
            assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(action, true, action, NOW - 1_000L, NOW));
        }
        assertFalse(VpnLifecycleStartPolicy.shouldStart(null, true, true, NOW - 1_000L, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldStartWithConsent(null, true, true, NOW - 1_000L, NOW, true));
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(null, null, NOW - 1_000L, NOW));
        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(null, true, null, NOW - 1_000L, NOW));
    }
}
