package com.swir.xadkiller;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DnsUpstreamPoolTest {
    private static final String[] SERVERS = {"1.1.1.1", "9.9.9.9", "8.8.8.8"};

    @Test public void keepsConfiguredOrderBeforeHealthSamples() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        assertArrayEquals(SERVERS, pool.order(1_000L));
    }

    @Test public void promotesFastHealthyResolver() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("9.9.9.9", 24L, 1_000L);
        assertEquals("9.9.9.9", pool.order(1_001L)[0]);
        assertEquals(1L, pool.successes("9.9.9.9"));
    }

    @Test public void persistentlySlowSuccessfulResolverIsDemotedWithoutFailure() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1600L, 1_000L);
        pool.recordSuccess("1.1.1.1", 1700L, 1_100L);
        pool.recordSuccess("9.9.9.9", 45L, 1_200L);

        assertEquals("9.9.9.9", pool.order(1_201L)[0]);
        assertEquals(2, pool.slowStreak("1.1.1.1"));
        assertEquals(0, pool.failureStreak("1.1.1.1"));
        assertEquals(0L, pool.failures("1.1.1.1"));
        assertTrue(pool.snapshot(1_201L).contains("slow=2"));
    }

    @Test public void fastResponsesDecaySlowPenaltyAndAllowRecovery() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1800L, 1_000L);
        pool.recordSuccess("1.1.1.1", 1700L, 1_100L);
        assertEquals(2, pool.slowStreak("1.1.1.1"));

        pool.recordSuccess("1.1.1.1", 20L, 1_200L);
        pool.recordSuccess("1.1.1.1", 18L, 1_300L);
        assertEquals(0, pool.slowStreak("1.1.1.1"));
        assertEquals("1.1.1.1", pool.order(1_301L)[0]);
    }

    @Test public void coolingResolverIsMovedBehindHealthyResolvers() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 20L, 1_000L);
        pool.recordFailure("1.1.1.1", 2_000L);
        String[] duringCooldown = pool.order(2_100L);
        assertTrue(!"1.1.1.1".equals(duringCooldown[0]));
        assertEquals(1L, pool.failures("1.1.1.1"));
    }

    @Test public void expiredCooldownGetsSingleHalfOpenProbe() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordFailure("1.1.1.1", 1_000L); // cooldown until 2500
        pool.recordFailure("9.9.9.9", 1_100L); // cooldown until 2600

        assertEquals("8.8.8.8", pool.order(2_000L)[0]);

        String[] firstRecovery = pool.order(2_700L);
        assertEquals("1.1.1.1", firstRecovery[0]);
        assertEquals("8.8.8.8", firstRecovery[1]);
        assertEquals("9.9.9.9", firstRecovery[2]);
        assertTrue(pool.snapshot(2_700L).contains("1.1.1.1 180ms probe"));
    }

    @Test public void failedHalfOpenProbeReturnsToCooldownAndLetsNextRecover() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordFailure("1.1.1.1", 1_000L);
        pool.recordFailure("9.9.9.9", 1_100L);
        assertEquals("1.1.1.1", pool.order(2_700L)[0]);

        pool.recordFailure("1.1.1.1", 2_701L);
        assertEquals("9.9.9.9", pool.order(2_702L)[0]);
        assertEquals(2, pool.failureStreak("1.1.1.1"));
    }

    @Test public void successfulRetryRecoversResolverImmediately() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordFailure("1.1.1.1", 1_000L);
        pool.recordFailure("1.1.1.1", 1_100L);
        assertTrue(!"1.1.1.1".equals(pool.order(1_200L)[0]));
        pool.recordSuccess("1.1.1.1", 18L, 1_300L);
        assertEquals("1.1.1.1", pool.order(1_301L)[0]);
        assertEquals(0, pool.failureStreak("1.1.1.1"));
    }

    @Test public void adaptiveTimeoutIsAlwaysBounded() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        assertTrue(pool.timeoutMs("1.1.1.1", 1_000L) >= 1200);
        assertTrue(pool.timeoutMs("1.1.1.1", 1_000L) <= 3200);
        for (int i = 0; i < 12; i++) pool.recordFailure("1.1.1.1", 1_000L + i);
        assertEquals(3200, pool.timeoutMs("1.1.1.1", 2_000L));
        pool.recordSuccess("1.1.1.1", 1L, 10_000L);
        assertTrue(pool.timeoutMs("1.1.1.1", 10_001L) >= 1200);
        assertTrue(pool.timeoutMs("1.1.1.1", 10_001L) <= 3200);
    }

    @Test public void halfOpenProbeTimeoutIsCappedToProtectUserLatency() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        for (int i = 0; i < 12; i++) pool.recordFailure("1.1.1.1", 1_000L + i);
        assertEquals(1800, pool.timeoutMs("1.1.1.1", 70_000L));
    }

    @Test public void diagnosticsContainOnlyResolverHealthAggregates() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 42L, 1_000L);
        String snapshot = pool.snapshot(1_001L);
        assertTrue(snapshot.contains("1.1.1.1"));
        assertTrue(snapshot.contains("42ms"));
        assertTrue(!snapshot.contains("http"));
    }
}
