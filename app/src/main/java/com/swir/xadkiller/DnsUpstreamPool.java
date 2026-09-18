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
 * v1.6 adds a circuit-breaker style half-open recovery probe. Cooling resolvers
 * are now actually removed from the per-query attempt list while healthy capacity
 * exists; previously they were only sorted to the end and were still retried by
 * every DNS query. Exactly one expired resolver is exposed as a half-open probe.
 * If every resolver is still cooling, one earliest-recovery server is retained as
 * a bounded emergency path so DNS does not become deterministically unavailable.
 *
 * Persistently slow but technically successful resolvers also receive a bounded
 * ranking penalty. They remain usable as fallbacks and are not marked failed,
 * while faster healthy resolvers move ahead. Fast responses decay that penalty
 * again so temporary network congestion does not permanently demote a provider.
 *
 * A single valid-but-extreme RTT sample is dampened before it enters the EWMA
 * once a resolver has an established baseline. The real RTT still increments
 * the slow-response streak, so repeated slowness is penalized while one scheduler,
 * radio or handover spike cannot inflate adaptive timeouts for many later queries.
 *
 * Latency-only health is also aged after long periods without observations.
 * Android can switch between Wi-Fi and mobile networks while the VPN stays up;
 * carrying an old RTT penalty forever would bias the new network with stale
 * information. Failure/circuit-breaker state is deliberately not forgotten by
 * this passive aging and still requires a bounded half-open recovery probe.
 *
 * A newly established VPN/network epoch can explicitly reset only latency-derived
 * state. Lifetime success/failure counters and circuit-breaker failures remain
 * intact, while RTT/slow penalties start from a neutral baseline for the new path.
 *
 * Runtime timestamps are also rebased if the supplied clock moves backwards
 * (for example after a manual/NTP wall-clock correction). Remaining cooldown and
 * latency-aging durations are preserved instead of becoming artificially long or
 * negative. This is defensive even when callers later migrate to a monotonic clock.
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
    private static final int OUTLIER_BASELINE_SUCCESSES = 2;
    private static final double OUTLIER_MIN_CEILING_MS = 800d;
    private static final double OUTLIER_EWMA_MULTIPLIER = 3.0d;
    private static final long STALE_LATENCY_STEP_MS = 10L * 60L * 1000L;
    private static final double STALE_RTT_RETAIN = 0.50d;

    private static final class State {
        final String server;
        final int ordinal;
        double ewmaRttMs = DEFAULT_RTT_MS;
        int failureStreak;
        int slowStreak;
        int latencySamples;
        long cooldownUntilMs;
        long successes;
        long failures;
        long lastObservationAtMs;
        long lastLatencyDecayAtMs;

        State(String server, int ordinal) {
            this.server = server;
            this.ordinal = ordinal;
        }
    }

    private final List<State> states = new ArrayList<>();
    private final Map<String, State> byServer = new HashMap<>();
    private long lastNowMs = Long.MIN_VALUE;

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
        final long stableNowMs = stableNow(nowMs);
        ageStaleLatency(stableNowMs);
        final State probe = recoveryProbeCandidate(stableNowMs);
        List<State> eligible = new ArrayList<>();

        if (probe != null) eligible.add(probe);
        for (State state : states) {
            if (state != probe && state.failureStreak == 0) eligible.add(state);
        }

        // When every resolver is cooling, keep exactly one emergency path instead of
        // retrying the entire failed pool for every application DNS query. This preserves
        // reachability during provider-wide outages while bounding repeated user latency.
        if (eligible.isEmpty()) {
            State emergency = states.stream()
                    .min(Comparator
                            .comparingLong((State s) -> s.cooldownUntilMs)
                            .thenComparingDouble(this::score)
                            .thenComparingInt(s -> s.ordinal))
                    .orElse(states.get(0));
            eligible.add(emergency);
        }

        eligible.sort(Comparator
                .comparingInt((State s) -> s == probe ? 0 : 1)
                .thenComparingDouble(this::score)
                .thenComparingInt(s -> s.ordinal));
        return serverArray(eligible);
    }

    synchronized int timeoutMs(String server) {
        return timeoutMs(server, System.currentTimeMillis());
    }

    synchronized int timeoutMs(String server, long nowMs) {
        nowMs = stableNow(nowMs);
        ageStaleLatency(nowMs);
        State state = byServer.get(server);
        if (state == null) return 2200;
        int adaptive = (int)Math.round(900d + state.ewmaRttMs * 4.0d + state.failureStreak * 180d);
        adaptive = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, adaptive));
        if (isHalfOpen(state, nowMs)) adaptive = Math.min(adaptive, HALF_OPEN_TIMEOUT_MAX_MS);
        return adaptive;
    }

    synchronized void onNetworkChanged(long nowMs) {
        nowMs = stableNow(nowMs);
        for (State state : states) {
            state.ewmaRttMs = DEFAULT_RTT_MS;
            state.slowStreak = 0;
            state.latencySamples = 0;
            state.lastObservationAtMs = nowMs;
            state.lastLatencyDecayAtMs = nowMs;
        }
    }

    synchronized void recordSuccess(String server, long rttMs, long nowMs) {
        nowMs = stableNow(nowMs);
        State state = byServer.get(server);
        if (state == null) return;
        ageStateLatency(state, nowMs);
        double rawSample = Math.max(1d, Math.min(5000d, (double)rttMs));
        double sample = rawSample;
        if (state.latencySamples >= OUTLIER_BASELINE_SUCCESSES) {
            double ceiling = Math.max(OUTLIER_MIN_CEILING_MS, state.ewmaRttMs * OUTLIER_EWMA_MULTIPLIER);
            sample = Math.min(rawSample, ceiling);
        }
        state.ewmaRttMs = state.latencySamples == 0
                ? sample
                : (state.ewmaRttMs * 0.72d + sample * 0.28d);
        state.latencySamples++;
        state.successes++;
        state.failureStreak = 0;
        state.cooldownUntilMs = 0L;
        if (rttMs >= SLOW_RTT_MS) state.slowStreak = Math.min(MAX_SLOW_STREAK, state.slowStreak + 1);
        else state.slowStreak = Math.max(0, state.slowStreak - 1);
        state.lastObservationAtMs = nowMs;
        state.lastLatencyDecayAtMs = nowMs;
    }

    synchronized void recordFailure(String server, long nowMs) {
        nowMs = stableNow(nowMs);
        State state = byServer.get(server);
        if (state == null) return;
        ageStateLatency(state, nowMs);
        state.failures++;
        state.failureStreak = Math.min(12, state.failureStreak + 1);
        state.slowStreak = Math.max(0, state.slowStreak - 1);
        int shift = Math.min(5, Math.max(0, state.failureStreak - 1));
        long cooldown = Math.min(MAX_COOLDOWN_MS, 1500L << shift);
        state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + cooldown);
        state.lastObservationAtMs = nowMs;
        state.lastLatencyDecayAtMs = nowMs;
    }

    synchronized String snapshot(long nowMs) {
        nowMs = stableNow(nowMs);
        ageStaleLatency(nowMs);
        StringBuilder out = new StringBuilder();
        State probe = recoveryProbeCandidate(nowMs);
        List<State> ordered = new ArrayList<>(states);
        ordered.sort(Comparator
                .comparingInt((State s) -> orderClass(s, probe, nowMs))
                .thenComparingDouble(this::score)
                .thenComparingLong(s -> s.cooldownUntilMs)
                .thenComparingInt(s -> s.ordinal));
        for (State state : ordered) {
            if (out.length() > 0) out.append(" • ");
            out.append(state.server).append(' ').append(Math.round(state.ewmaRttMs)).append("ms");
            if (state.cooldownUntilMs > nowMs) {
                out.append(" cool=").append(Math.max(1L, (state.cooldownUntilMs - nowMs + 999L) / 1000L)).append('s');
            } else if (state == probe) out.append(" probe");
            else if (state.failureStreak > 0) out.append(" recover=").append(state.failureStreak);
            else if (state.slowStreak > 0) out.append(" slow=").append(state.slowStreak);
            else out.append(" ok");
        }
        return out.toString();
    }

    synchronized long successes(String server) { State state = byServer.get(server); return state == null ? 0L : state.successes; }
    synchronized long failures(String server) { State state = byServer.get(server); return state == null ? 0L : state.failures; }
    synchronized int failureStreak(String server) { State state = byServer.get(server); return state == null ? 0 : state.failureStreak; }
    synchronized int slowStreak(String server) { State state = byServer.get(server); return state == null ? 0 : state.slowStreak; }

    private String[] serverArray(List<State> ordered) {
        String[] result = new String[ordered.size()];
        for (int i = 0; i < ordered.size(); i++) result[i] = ordered.get(i).server;
        return result;
    }

    private long stableNow(long nowMs) {
        if (lastNowMs == Long.MIN_VALUE) { lastNowMs = nowMs; return nowMs; }
        if (nowMs >= lastNowMs) { lastNowMs = nowMs; return nowMs; }
        long delta = lastNowMs - nowMs;
        for (State state : states) {
            state.cooldownUntilMs = rebaseTimestamp(state.cooldownUntilMs, delta);
            state.lastObservationAtMs = rebaseTimestamp(state.lastObservationAtMs, delta);
            state.lastLatencyDecayAtMs = rebaseTimestamp(state.lastLatencyDecayAtMs, delta);
        }
        lastNowMs = nowMs;
        return nowMs;
    }

    private long rebaseTimestamp(long value, long delta) {
        if (value <= 0L || delta <= 0L) return value;
        return value > delta ? value - delta : 1L;
    }

    private void ageStaleLatency(long nowMs) { for (State state : states) ageStateLatency(state, nowMs); }

    private void ageStateLatency(State state, long nowMs) {
        if (state.lastObservationAtMs <= 0L || nowMs <= state.lastObservationAtMs) return;
        long anchor = Math.max(state.lastObservationAtMs, state.lastLatencyDecayAtMs);
        long elapsed = nowMs - anchor;
        if (elapsed < STALE_LATENCY_STEP_MS) return;
        long steps = Math.min(12L, elapsed / STALE_LATENCY_STEP_MS);
        double retain = Math.pow(STALE_RTT_RETAIN, steps);
        state.ewmaRttMs = DEFAULT_RTT_MS + (state.ewmaRttMs - DEFAULT_RTT_MS) * retain;
        state.slowStreak = Math.max(0, state.slowStreak - (int)steps);
        state.lastLatencyDecayAtMs = anchor + steps * STALE_LATENCY_STEP_MS;
    }

    private State recoveryProbeCandidate(long nowMs) {
        State best = null;
        for (State state : states) {
            if (!isHalfOpen(state, nowMs)) continue;
            if (best == null || state.cooldownUntilMs < best.cooldownUntilMs
                    || (state.cooldownUntilMs == best.cooldownUntilMs && state.ordinal < best.ordinal)) best = state;
        }
        return best;
    }

    private boolean isHalfOpen(State state, long nowMs) {
        return state.failureStreak > 0 && state.cooldownUntilMs > 0L && state.cooldownUntilMs <= nowMs;
    }

    private int orderClass(State state, State probe, long nowMs) {
        if (state == probe) return 0;
        if (state.failureStreak == 0) return 1;
        if (state.cooldownUntilMs <= nowMs) return 2;
        return 3;
    }

    private double score(State state) {
        return state.ewmaRttMs + state.failureStreak * 550d + state.slowStreak * SLOW_STREAK_PENALTY_MS;
    }

    @Override public synchronized String toString() {
        return String.format(Locale.ROOT, "DnsUpstreamPool%s", Arrays.toString(order(System.currentTimeMillis())));
    }
}
