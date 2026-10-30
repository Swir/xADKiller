package com.swir.xadkiller;

/** Prevent a cancelled worker from creating or closing a subsequent session's tunnel. */
final class VpnSessionEpoch {
    private long generation;
    private boolean active;

    synchronized long begin() {
        active = true;
        return ++generation;
    }

    synchronized boolean owns(long token) {
        return active && token == generation;
    }

    synchronized void cancel() {
        active = false;
        generation++;
    }
}
