package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VpnLifecycleStartPolicyTest {
    @Test public void bootStartsOnlyWhenAutostartIsEnabled() {
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true, false));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, false, true));
    }

    @Test public void packageUpdateRestartsOnlyProtectionThatWasActuallyRunning() {
        assertTrue(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, true));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, true, false));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED, false, true));
    }

    @Test public void unrelatedBroadcastsNeverStartTheVpn() {
        assertFalse(VpnLifecycleStartPolicy.shouldStart("android.intent.action.TIME_SET", true, true));
        assertFalse(VpnLifecycleStartPolicy.shouldStart(null, true, true));
    }
}
