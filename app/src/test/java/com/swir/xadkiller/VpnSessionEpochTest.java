package com.swir.xadkiller;

import org.junit.Test;
import static org.junit.Assert.*;

public class VpnSessionEpochTest {
    @Test public void delayedStartupAfterStopCannotEstablishTunnel() {
        VpnSessionEpoch sessions = new VpnSessionEpoch();
        long loading = sessions.begin();
        sessions.cancel();
        assertFalse(sessions.owns(loading));
    }
    @Test public void previousWorkerCannotCleanUpRestartedSession() {
        VpnSessionEpoch sessions = new VpnSessionEpoch();
        long oldWorker = sessions.begin();
        sessions.cancel();
        long newWorker = sessions.begin();
        assertFalse(sessions.owns(oldWorker));
        assertTrue(sessions.owns(newWorker));
        sessions.cancel();
        assertFalse(sessions.owns(newWorker));
    }
}
