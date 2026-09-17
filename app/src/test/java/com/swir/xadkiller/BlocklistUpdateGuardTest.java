package com.swir.xadkiller;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BlocklistUpdateGuardTest {
    @Test public void rejectsObviouslyIncompleteFirstDownload() {
        assertFalse(BlocklistManager.candidateCountLooksHealthy("", "STANDARD", 0, 999));
        assertTrue(BlocklistManager.candidateCountLooksHealthy("", "STANDARD", 0, 1000));
    }

    @Test public void rejectsSuddenSameModeShrink() {
        assertFalse(BlocklistManager.candidateCountLooksHealthy("STANDARD", "STANDARD", 100_000, 44_999));
        assertTrue(BlocklistManager.candidateCountLooksHealthy("STANDARD", "STANDARD", 100_000, 45_000));
        assertFalse(BlocklistManager.candidateCountLooksHealthy("ULTRA", "ULTRA", 700_000, 300_000));
        assertTrue(BlocklistManager.candidateCountLooksHealthy("ULTRA", "ULTRA", 700_000, 315_000));
    }

    @Test public void modeSwitchDoesNotCompareDifferentSizedFeeds() {
        assertTrue(BlocklistManager.candidateCountLooksHealthy("ULTRA", "STANDARD", 700_000, 25_000));
        assertTrue(BlocklistManager.candidateCountLooksHealthy("STANDARD", "ULTRA", 25_000, 600_000));
    }

    @Test public void tinyPreviousCacheDoesNotLockOutRecovery() {
        assertTrue(BlocklistManager.candidateCountLooksHealthy("STANDARD", "STANDARD", 1500, 1200));
    }
}
