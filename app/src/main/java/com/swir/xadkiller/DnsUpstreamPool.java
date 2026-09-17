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
 *
 * v1.6 adds a circuit-breaker style half-open recovery probe. Once a resolver's
 * cooldown expires, exactly one recovering resolver is allowed to move ahead of
 * healthy resolvers for a bounded probe. A successful probe restores it
 * immediately; another failure returns it to exponential cooldown. This avoids
 * permanently starving a resolver after a temporary network/provider outage.
 *
 * Persistently slow but technically successful resolvers also receive a bounded
 * ranking penalty. They remain usable as fallbacks and are not marked failed,
 * while faster healthy resolvers move ahead. Fast responses decay that penalty
 * again so temporary network congestion does not permanently demote a provider.
 */
final class DnsUpstreamPool {
    private static final int DEFAULT_RTT_MS = 180;
    private static final int MIN_TIMEOUT_MS = 1200;
    private static final int MAX_TIMEOUT_MS = 3200;
    private static final int HALF_OPEN_TIMEOUT_MAX_MS = 1800;
    private static final long MAX_COOLDOWN_MS = 60_000L;
    private static final long SLOW_RTT_MS = 1500L;
    private static final int MAX_SLOW_STREAK = 4;
    private static final double SLOW_STREAK_PENALTY_MS = 260d;

    private static final class State {
        final String server;
        final int ordinal;
        double ewmaRttMs = DEFAULT_RTT_MS;
        int failureStreak;
        int slowStreak;
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
        final State probe = recoveryProbeCandidate(nowMs);
        ordered.sort(Comparator
                .comparingInt((State s) -> orderClass(s, probe, nowMs))
                .thenComparingDouble(this::score)
                .thenComparingLong(s -> s.cooldownUntilMs)
                .thenComparingInt(s -> s.ordinal));
        String[] result = new String[ordered.size()];
        for (int i = 0; i < ordered.size(); i++) result[i] = ordered.get(i).server;
        return result;
    }

    synchronized int timeoutMs(String server) {
        return timeoutMs(server, System.currentTimeMillis());
    }

    synchronized int timeoutMs(String server, long nowMs) {
        State state = byServer.get(server);
        if (state == null) return 2200;
        int adaptive = (int)Math.round(900d + state.ewmaRttMs * 4.0d + state.failureStreak * 180d);
        adaptive = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, adaptive));
        if (isHalfOpen(state, nowMs)) adaptive = Math.min(adaptive, HALF_OPEN_TIMEOUT_MAX_MS);
        return adaptive;
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
        if (rttMs >= SLOW_RTT_MS) {
            state.slowStreak = Math.min(MAX_SLOW_STREAK, state.slowStreak + 1);
        } else {
            state.slowStreak = Math.max(0, state.slowStreak - 1);
        }
    }

    synchronized void recordFailure(String server, long nowMs) {
        State state = byServer.get(server);
        if (state == null) return;
        state.failures++;
        state.failureStreak = Math.min(12, state.failureStreak + 1);
        state.slowStreak = Math.max(0, state.slowStreak - 1);
        int shift = Math.min(5, Math.max(0, state.failureStreak - 1));
        long cooldown = Math.min(MAX_COOLDOWN_MS, 1500L << shift);
        state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + cooldown);
    }

    synchronized String snapshot(long nowMs) {
        StringBuilder out = new StringBuilder();
        State probe = recoveryProbeCandidate(nowMs);
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
            } else if (state == probe) {
                out.append(" probe");
            } else if (state.failureStreak > 0) {
                out.append(" recover=").append(state.failureStreak);
            } else if (state.slowStreak > 0) {
                out.append(" slow=").append(state.slowStreak);
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

    synchronized int failureStreak(String server) {
        State state = byServer.get(server);
        return state == null ? 0 : state.failureStreak;
    }

    synchronized int slowStreak(String server) {
        State state = byServer.get(server);
        return state == null ? 0 : state.slowStreak;
    }

    private State recoveryProbeCandidate(long nowMs) {
        State best = null;
        for (State state : states) {
            if (!isHalfOpen(state, nowMs)) continue;
            if (best == null
                    || state.cooldownUntilMs < best.cooldownUntilMs
                    || (state.cooldownUntilMs == best.cooldownUntilMs && state.ordinal < best.ordinal)) {
                best = state;
            }
        }
        return best;
    }

    private boolean isHalfOpen(State state, long nowMs) {
        return state.failureStreak > 0 && state.cooldownUntilMs > 0L && state.cooldownUntilMs <= nowMs;
    }

    private int orderClass(State state, State probe, long nowMs) {
        if (state == probe) return 0;                         // one bounded recovery probe
        if (state.failureStreak == 0) return 1;               // healthy pool
        if (state.cooldownUntilMs <= nowMs) return 2;         // other recoverable servers wait
        return 3;                                             // active cooldown always last
    }

    private double score(State state) {
        return state.ewmaRttMs
                + state.failureStreak * 550d
                + state.slowStreak * SLOW_STREAK_PENALTY_MS;
    }

    @Override public synchronized String toString() {
        return String.format(Locale.ROOT, "DnsUpstreamPool%s", Arrays.toString(order(System.currentTimeMillis())));
    }
}
