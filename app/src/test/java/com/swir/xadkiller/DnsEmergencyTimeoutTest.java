package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Regression coverage for the provider-wide DNS outage emergency path. */
public class DnsEmergencyTimeoutTest {
    private static final String[] SERVERS = {"1.1.1.1", "9.9.9.9", "8.8.8.8"};

    @Test public void allCoolingEmergencyAttemptUsesMinimumTimeout() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        for (int i = 0; i < 3; i++) {
            pool.recordFailure("1.1.1.1", 1_000L + i);
            pool.recordFailure("9.9.9.9", 1_100L + i);
            pool.recordFailure("8.8.8.8", 1_200L + i);
        }

        long duringCooldown = 2_000L;
        String[] attempts = pool.order(duringCooldown);
        assertEquals(1, attempts.length);
        assertEquals(1200, pool.timeoutMs(attempts[0], duringCooldown));
    }

    @Test public void healthyAlternativeDoesNotForceMinimumTimeoutOnCoolingResolver() {
        DnsUpstreamPool pool = new DnsUpstreamPool(SERVERS);
        for (int i = 0; i < 3; i++) pool.recordFailure("1.1.1.1", 1_000L + i);

        // The failed resolver is omitted while healthy capacity exists. Its timeout
        // remains the normal bounded adaptive value; the minimum cap is reserved for
        // the single emergency attempt when every configured provider is cooling.
        assertEquals(2, pool.order(2_000L).length);
        int timeout = pool.timeoutMs("1.1.1.1", 2_000L);
        assertTrue(timeout > 1200);
        assertTrue(timeout <= 3200);
    }
}
