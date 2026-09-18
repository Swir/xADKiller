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

    @Test public void oneSuccessfulLatencySpikeIsDampenedButStillMarkedSlow() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 35L, 1_000L);
        pool.recordSuccess("1.1.1.1", 40L, 1_100L);
        int before = pool.timeoutMs("1.1.1.1", 1_101L);
        pool.recordSuccess("1.1.1.1", 5_000L, 1_200L);

        assertEquals(1, pool.slowStreak("1.1.1.1"));
        assertEquals(0, pool.failureStreak("1.1.1.1"));
        assertEquals(3L, pool.successes("1.1.1.1"));
        assertTrue(pool.timeoutMs("1.1.1.1", 1_201L) < 2_200);
        assertTrue(pool.timeoutMs("1.1.1.1", 1_201L) >= before);
        assertTrue(pool.snapshot(1_201L).contains("slow=1"));
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

    @Test public void fastResponsesDecaySlowPenaltyAndEwmaUntilResolverRecovers() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1800L, 1_000L);
        pool.recordSuccess("1.1.1.1", 1700L, 1_100L);
        assertEquals(2, pool.slowStreak("1.1.1.1"));

        for (int i = 0; i < 8; i++) {
            pool.recordSuccess("1.1.1.1", 20L, 1_200L + i * 100L);
        }
        assertEquals(0, pool.slowStreak("1.1.1.1"));
        assertEquals("1.1.1.1", pool.order(2_001L)[0]);
    }

    @Test public void staleLatencyPenaltyAgesWithoutNewDnsTraffic() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1900L, 1_000L);
        pool.recordSuccess("1.1.1.1", 1900L, 1_100L);
        pool.recordSuccess("1.1.1.1", 1900L, 1_200L);
        assertEquals(3, pool.slowStreak("1.1.1.1"));
        assertEquals(3200, pool.timeoutMs("1.1.1.1", 1_201L));

        long afterFortyMinutes = 1_200L + 40L * 60L * 1000L;
        pool.order(afterFortyMinutes);
        assertEquals(0, pool.slowStreak("1.1.1.1"));
        assertTrue(pool.timeoutMs("1.1.1.1", afterFortyMinutes) < 2200);
        assertEquals(0, pool.failureStreak("1.1.1.1"));
    }

    @Test public void staleLatencyAgingNeverClearsCircuitBreakerFailureState() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1900L, 1_000L);
        pool.recordFailure("1.1.1.1", 1_100L);
        assertEquals(1, pool.failureStreak("1.1.1.1"));

        long afterTwoHours = 1_100L + 2L * 60L * 60L * 1000L;
        assertEquals("1.1.1.1", pool.order(afterTwoHours)[0]);
        assertEquals(1, pool.failureStreak("1.1.1.1"));
        assertTrue(pool.snapshot(afterTwoHours).contains("probe"));
    }

    @Test public void networkChangeImmediatelyClearsLatencyOnlyPenalty() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1900L, 1_000L);
        pool.recordSuccess("1.1.1.1", 1800L, 1_100L);
        pool.recordSuccess("9.9.9.9", 40L, 1_200L);
        assertEquals("9.9.9.9", pool.order(1_201L)[0]);
        assertEquals(2, pool.slowStreak("1.1.1.1"));

        pool.onNetworkChanged(2_000L);

        assertEquals(0, pool.slowStreak("1.1.1.1"));
        assertArrayEquals(SERVERS, pool.order(2_001L));
        assertEquals(1620, pool.timeoutMs("1.1.1.1", 2_001L));
        assertEquals(2L, pool.successes("1.1.1.1"));
    }

    @Test public void networkChangePreservesCircuitBreakerAndLifetimeCounters() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 1700L, 1_000L);
        pool.recordFailure("1.1.1.1", 1_100L);
        assertEquals(1, pool.failureStreak("1.1.1.1"));

        pool.onNetworkChanged(1_200L);

        assertEquals(1, pool.failureStreak("1.1.1.1"));
        assertEquals(1L, pool.failures("1.1.1.1"));
        assertEquals(1L, pool.successes("1.1.1.1"));
        assertTrue(!"1.1.1.1".equals(pool.order(1_201L)[0]));
        assertTrue(pool.snapshot(1_201L).contains("cool="));
    }

    @Test public void firstSampleAfterNetworkChangeStartsFreshLatencyBaseline() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordSuccess("1.1.1.1", 30L, 1_000L);
        pool.recordSuccess("1.1.1.1", 35L, 1_100L);
        pool.onNetworkChanged(2_000L);
        pool.recordSuccess("1.1.1.1", 1600L, 2_100L);

        assertEquals(1, pool.slowStreak("1.1.1.1"));
        assertEquals(3L, pool.successes("1.1.1.1"));
        assertEquals(3200, pool.timeoutMs("1.1.1.1", 2_101L));
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
        pool.recordFailure("1.1.1.1", 1_000L);
        pool.recordFailure("9.9.9.9", 1_100L);
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
