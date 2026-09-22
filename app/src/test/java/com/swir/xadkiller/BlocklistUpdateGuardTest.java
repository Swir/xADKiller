package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

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

    @Test public void uniqueCounterRejectsDuplicateInflatedFeed() throws Exception {
        StringBuilder duplicateFeed = new StringBuilder();
        for (int i = 0; i < 2500; i++) duplicateFeed.append("ads.example.test\n");
        int unique = BlocklistManager.countUniqueNormalized(
                new ByteArrayInputStream(duplicateFeed.toString().getBytes(StandardCharsets.UTF_8)), 10_000);
        assertEquals(1, unique);
        assertFalse(BlocklistManager.candidateCountLooksHealthy("", "STANDARD", 0, unique));
    }

    @Test public void uniqueCounterNormalizesHostsAndAdblockSyntax() throws Exception {
        String feed = "0.0.0.0 Ads.Example.Test\n"
                + "||ads.example.test^\n"
                + "tracker.example.test\n"
                + "# comment\n"
                + "@@||allowed.example.test^\n";
        int unique = BlocklistManager.countUniqueNormalized(
                new ByteArrayInputStream(feed.getBytes(StandardCharsets.UTF_8)), 100);
        assertEquals(2, unique);
    }
}
