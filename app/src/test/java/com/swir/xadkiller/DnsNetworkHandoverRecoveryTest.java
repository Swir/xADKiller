package com.swir.xadkiller;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DnsNetworkHandoverRecoveryTest {
    private static final String[] SERVERS = {"1.1.1.1", "9.9.9.9", "8.8.8.8"};

    @Test public void networkChangeArmsImmediateHalfOpenProbeWithoutClearingFailureHistory() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordFailure("1.1.1.1", 1_000L);

        assertArrayEquals(new String[]{"9.9.9.9", "8.8.8.8"}, pool.order(1_100L));
        assertTrue(pool.snapshot(1_100L).contains("cool="));

        pool.onNetworkChanged(1_200L);

        assertArrayEquals(SERVERS, pool.order(1_201L));
        assertEquals(1, pool.failureStreak("1.1.1.1"));
        assertEquals(1L, pool.failures("1.1.1.1"));
        assertTrue(pool.snapshot(1_201L).contains("1.1.1.1 180ms probe"));
        assertTrue(pool.timeoutMs("1.1.1.1", 1_201L) <= 1800);
    }

    @Test public void networkChangeStillExposesOnlyOneFailedResolverProbePerAttemptList() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        pool.recordFailure("1.1.1.1", 1_000L);
        pool.recordFailure("9.9.9.9", 1_001L);

        pool.onNetworkChanged(2_000L);
        assertArrayEquals(new String[]{"1.1.1.1", "8.8.8.8"}, pool.order(2_001L));
        assertTrue(pool.snapshot(2_001L).contains("9.9.9.9 180ms recover=1"));

        // A failed half-open probe returns to cooldown; the next failed resolver is then
        // allowed one bounded probe on the following attempt list instead of retrying both.
        pool.recordFailure("1.1.1.1", 2_002L);
        assertArrayEquals(new String[]{"9.9.9.9", "8.8.8.8"}, pool.order(2_003L));
        assertEquals(2, pool.failureStreak("1.1.1.1"));
        assertEquals(1, pool.failureStreak("9.9.9.9"));
    }
}
