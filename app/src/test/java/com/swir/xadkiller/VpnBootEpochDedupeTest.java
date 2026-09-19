package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Regression coverage for persisted elapsedRealtime restart markers crossing a real reboot. */
public class VpnBootEpochDedupeTest {
    private static final long NOW_ELAPSED = 20_000L;
    private static final long PREVIOUS_MARKER = 10_000L;

    @Test public void previousBootMarkerCannotSuppressCurrentBootEvenWhenElapsedValuesOverlap() {
        // Without a boot-generation discriminator this shape looks like a 10-second duplicate,
        // even though the marker belongs to the previous device boot.
        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED));

        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                41, 42));

        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                41, 42));
    }

    @Test public void legacyUnboundMarkerCannotSuppressWhenCurrentBootGenerationIsKnown() {
        // Upgrades from a build that persisted elapsedRealtime but not BOOT_COUNT may leave a
        // plausible-looking marker behind. Once the current boot generation is readable, an
        // unbound legacy marker cannot prove it belongs to this boot and must fail open.
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                -1, 42));

        assertFalse(VpnLifecycleStartPolicy.shouldSuppressStartAttempt(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED, true,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                -1, 42));
    }

    @Test public void sameBootBurstStillDeduplicatesAndUnavailableCurrentBootCountKeepsFallback() {
        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                42, 42));

        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                -1, -1));

        // If this OEM/build cannot read the current boot count, retain the monotonic-clock
        // fallback rather than disabling duplicate suppression altogether.
        assertTrue(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                42, -1));
    }

    @Test public void bootEpochDoesNotChangeCrossActionRecoveryRule() {
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED,
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                42, 42));
        assertFalse(VpnLifecycleStartPolicy.isDuplicateRestart(
                VpnLifecycleStartPolicy.ACTION_BOOT_COMPLETED,
                VpnLifecycleStartPolicy.ACTION_MY_PACKAGE_REPLACED,
                PREVIOUS_MARKER, NOW_ELAPSED,
                42, 42));
    }
}
