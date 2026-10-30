package com.swir.xadkiller;

import org.junit.Test;
import static org.junit.Assert.*;

public class DnsPauseTest {
    @Test public void pauseExpiresAtDeadlineWithoutAnAlarmOrActivity() {
        long now = 1_000_000L;
        assertEquals(300_000L, DnsPause.remaining(now, now + 300_000L));
        assertEquals(1, DnsPause.remaining(now + 299_999L, now + 300_000L));
        assertEquals(0, DnsPause.remaining(now + 300_000L, now + 300_000L));
        assertEquals(0, DnsPause.remaining(now + 400_000L, now + 300_000L));
    }
    @Test public void rollbackOrCorruptionCannotExtendPauseBeyondFifteenMinutes() {
        assertEquals(0, DnsPause.remaining(0, Long.MAX_VALUE));
        assertEquals(0, DnsPause.remaining(-1, 1));
        assertEquals(0, DnsPause.remaining(100, 0));
        assertEquals(0, DnsPause.remaining(100, 100 + DnsPause.MAX_MS + 1));
        assertEquals(DnsPause.MAX_MS, DnsPause.remaining(100, 100 + DnsPause.MAX_MS));
    }
}
