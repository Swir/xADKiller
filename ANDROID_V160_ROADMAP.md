# xADKiller Android v1.6.0 — Mega Development Roadmap

This branch develops the Android APK independently from the current stable 1.5.1 line.

<img width="100%" src="assets/readme/android/progress-mini.svg" alt="xADKiller Android v1.6.0 roadmap progress" />

**Development progress:** **N/A** — this roadmap is priority-based and does not define a finite checkbox denominator, so no completion percentage is claimed.  
**Release readiness:** **BLOCKED** — manual physical-device VPN lifecycle and stability evidence is still required.

## Current validation snapshot — 2026-09-18
- Development APK CI is **GREEN** after the DNS network-epoch hardening batch: SWIR progress SVG consistency, privacy/network manifest gate, lint, unit tests + deterministic benchmark, APK build/package validation, ZIP integrity and SHA-256 all passed on the functional head.
- Deterministic offline DNS ad fixture coverage: **100.0% (96/96)**.
- Benign DNS control false positives: **0/20**.
- Bundled offline starter list: **95 high-confidence domains**, with larger maintained lists loaded at runtime.
- DNS parser hardening requires the IPv4 payload to contain exactly one complete UDP datagram and rejects IPv4 fragments, inconsistent IP/UDP lengths, response packets, non-standard opcodes, ambiguous multi-question DNS messages and invalid source port 0. This prevents unexplained trailing IPv4 payload from being silently ignored by the DNS parser.
- Upstream DNS response validation rejects mismatched question/name/type/class, malformed receive lengths and DNS responses carrying the TC (truncated) flag so the resolver pool can fail over instead of forwarding an incomplete UDP answer.
- Upstream DNS health scoring is GREEN: failure cooldown/half-open recovery remains bounded, persistently slow but successful resolvers are demoted without being marked failed, and stale latency-only penalties decay after long idle periods so old RTT history cannot bias a later network path indefinitely.
- Every newly established v1.6 VPN protection session now starts a **fresh DNS latency epoch**: RTT EWMA, slow-response penalties and the outlier baseline are reset to neutral while lifetime counters and circuit-breaker failure/cooldown state are preserved. This prevents a previous network path from poisoning resolver ranking after VPN restart without falsely declaring a failing resolver healthy.
- Established healthy resolvers dampen a **single valid-but-extreme RTT spike** before it enters the EWMA while still counting the real sample toward the slow-response streak; one scheduler/radio/handover stall therefore cannot pin adaptive DNS timeouts near their maximum, while repeated slowness is still penalized.
- Stale-latency aging and the explicit network-epoch reset never clear circuit-breaker failure state: a failed resolver still requires its bounded half-open recovery probe after cooldown.
- VPN service status has a **traffic-independent 5-second heartbeat** while the TUN worker is alive, so an idle connection no longer depends on DNS packet traffic to keep UI/service liveness fresh; the scheduler is shut down with the VPN/service lifecycle.
- Private DNS diagnostics now distinguish an established STRICT resolver from a STRICT resolver that is configured but not currently established, and surface a separate notice when Android reports an active network with zero DNS servers. The latter remains a non-fatal handover/captive-portal signal instead of being misreported as a healthy local DNS path. Per-app DoH remains explicitly **not reliably detectable** from Android system Private DNS APIs.
- Blocklist update hardening evaluates **normalized unique-domain counts**, preventing a duplicate-inflated remote feed from passing minimum-size or same-mode anti-shrink checks.
- Privacy hardening: Android backup is disabled for local xADKiller state; cleartext traffic remains disabled; CI enforces these invariants and rejects QUERY_ALL_PACKAGES.
- Release remains blocked until manual-device VPN lifecycle, Wi-Fi/mobile transitions, sleep/wake, real-app behavior and longer stability checks are satisfactory.

## Release gate
No Release until all relevant build, lint, regression, stability, privacy, DNS/VPN lifecycle, blocklist integrity and manual-device checks are green and there are no known critical issues.

## Core priorities
- Validate the traffic-independent VPN heartbeat and fresh DNS latency epoch across stop/restart, sleep/wake and Wi-Fi ↔ mobile transitions on physical devices so UI/service state and resolver ranking cannot drift.
- Improve DNS blocking accuracy without routing all user traffic through the VPN.
- Add safer upstream DNS fallback/health scoring and diagnostics.
- Improve blocklist quality, deduplication, corruption handling and offline fallback.
- Keep memory bounded with large lists and avoid UI/service ANRs.
- Improve false-positive recovery and per-domain controls.
- Continue Private DNS / encrypted-DNS diagnostics without pretending application-level DoH is observable when Android does not expose it, and document unsupported traffic classes clearly.
- Preserve privacy: no MITM, no remote executable code, no telemetry/profiling backend, no Android backup of local protection state.

## UI / UX
- Refresh the dark TITAN dashboard with clearer protection state and health indicators.
- Keep PL/EN as the primary maintained languages for this development line.
- Add clearer status cards for VPN, DNS upstream, blocklists, Smart Engine and last successful update.
- Improve error reporting and one-tap recovery actions.

## Test plan
- Gradle compile + lint + unit tests in CI.
- Privacy/network manifest gate.
- Manifest and signing checks.
- APK integrity/checksum checks.
- Deterministic SWIR Progress SVG math/XML/staleness check.
- VPN start/stop/restart/boot lifecycle regression coverage where possible; physical-device validation remains required for the heartbeat and OS lifecycle transitions.
- Parser/blocklist regression fixtures, including duplicate-inflated update rejection.
- DNS packet malformed/fragmented/query-shape/exact IPv4↔UDP length regression fixtures.
- DNS upstream response regression fixtures including TC=1 truncated UDP rejection.
- DNS upstream failover/half-open recovery, persistent-slow-resolver recovery, one-off RTT spike dampening, stale-latency aging and explicit network-epoch reset tests. The reset must clear latency-only state while preserving failure/cooldown state and lifetime counters.
- Private DNS diagnostic classification fixtures: established STRICT conflict, configured-but-unestablished STRICT resolver, automatic encrypted DNS, Private DNS off with reported resolvers, zero-reported-resolver handover/captive-portal notice, unknown/specifier fallback and no-network state; app-level DoH remains explicitly non-detectable by this system-level check.
- Memory/large-list stress checks.
- Manual device tests for Wi-Fi ↔ mobile data, sleep/wake and longer VPN stability.
- No Release from this branch until manual Android device validation is also satisfactory.
