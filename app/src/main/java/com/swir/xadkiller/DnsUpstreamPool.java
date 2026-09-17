package com.swir.xadkiller;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Small in-memory health scorer for the DNS resolvers used by the local VPN.
 *
 * The VPN must never get stuck retrying the same unhealthy resolver first for
 * every query. This class keeps only aggregate latency/failure counters; it
 * never sees or stores host names, DNS payloads or browsing history.
 */
final class DnsUpstreamPool {
    private static final int DEFAULT_RTT_MS = 180;
    private static final int MIN_TIMEOUT_MS = 1200;
    private static final int MAX_TIMEOUT_MS = 3200;
    private static final long MAX_COOLDOWN_MS = 60_000L;

    private static final class State {
        final String server;
        final int ordinal;
        double ewmaRttMs = DEFAULT_RTT_MS;
        int failureStreak;
        long cooldownUntilMs;
        long successes;
        long failures;

        State(String server, int ordinal) {
            this.server = server;
            this.ordinal = ordinal;
        }
    }

    private final List<State> states = new ArrayList<>();
    private final Map<String, State> byServer = new HashMap<>();

    DnsUpstreamPool(String[] servers) {
        if (servers == null || servers.length == 0) throw new IllegalArgumentException("servers");
        int ordinal = 0;
        for (String raw : servers) {
            String server = raw == null ? "" : raw.trim();
            if (server.isEmpty() || byServer.containsKey(server)) continue;
            State state = new State(server, ordinal++);
            states.add(state);
            byServer.put(server, state);
        }
        if (states.isEmpty()) throw new IllegalArgumentException("servers");
    }

    synchronized String[] order(long nowMs) {
        List<State> ordered = new ArrayList<>(states);
        ordered.sort(Comparator
                .comparingInt((State s) -> s.cooldownUntilMs > nowMs ? 1 : 0)
                .thenComparingLong(s -> s.cooldownUntilMs > nowMs ? s.cooldownUntilMs : 0L)
                .thenComparingDouble(this::score)
                .thenComparingInt(s -> s.ordinal));
        String[] result = new String[ordered.size()];
        for (int i = 0; i < ordered.size(); i++) result[i] = ordered.get(i).server;
        return result;
    }

    synchronized int timeoutMs(String server) {
        State state = byServer.get(server);
        if (state == null) return 2200;
        int adaptive = (int)Math.round(900d + state.ewmaRttMs * 4.0d + state.failureStreak * 180d);
        return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, adaptive));
    }

    synchronized void recordSuccess(String server, long rttMs, long nowMs) {
        State state = byServer.get(server);
        if (state == null) return;
        double sample = Math.max(1d, Math.min(5000d, (double)rttMs));
        state.ewmaRttMs = state.successes == 0
                ? sample
                : (state.ewmaRttMs * 0.72d + sample * 0.28d);
        state.successes++;
        state.failureStreak = 0;
        state.cooldownUntilMs = 0L;
    }

    synchronized void recordFailure(String server, long nowMs) {
        State state = byServer.get(server);
        if (state == null) return;
        state.failures++;
        state.failureStreak = Math.min(12, state.failureStreak + 1);
        int shift = Math.min(5, Math.max(0, state.failureStreak - 1));
        long cooldown = Math.min(MAX_COOLDOWN_MS, 1500L << shift);
        state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + cooldown);
    }

    synchronized String snapshot(long nowMs) {
        StringBuilder out = new StringBuilder();
        String[] order = order(nowMs);
        for (String server : order) {
            State state = byServer.get(server);
            if (state == null) continue;
            if (out.length() > 0) out.append(" • ");
            out.append(server)
                    .append(' ')
                    .append(Math.round(state.ewmaRttMs))
                    .append("ms");
            if (state.cooldownUntilMs > nowMs) {
                out.append(" cool=")
                        .append(Math.max(1L, (state.cooldownUntilMs - nowMs + 999L) / 1000L))
                        .append('s');
            } else if (state.failureStreak > 0) {
                out.append(" fail=").append(state.failureStreak);
            } else {
                out.append(" ok");
            }
        }
        return out.toString();
    }

    synchronized long successes(String server) {
        State state = byServer.get(server);
        return state == null ? 0L : state.successes;
    }

    synchronized long failures(String server) {
        State state = byServer.get(server);
        return state == null ? 0L : state.failures;
    }

    private double score(State state) {
        return state.ewmaRttMs + state.failureStreak * 550d;
    }

    @Override public synchronized String toString() {
        return String.format(Locale.ROOT, "DnsUpstreamPool%s", Arrays.toString(order(System.currentTimeMillis())));
    }
}
