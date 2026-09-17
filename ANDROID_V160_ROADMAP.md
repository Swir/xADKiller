# xADKiller Android v1.6.0 — Mega Development Roadmap

This branch develops the Android APK independently from the current stable 1.5.1 line.

<img width="100%" src="assets/readme/android/progress-mini.svg" alt="xADKiller Android v1.6.0 roadmap progress" />

**Development progress:** **N/A** — this roadmap is priority-based and does not define a finite checkbox denominator, so no completion percentage is claimed.  
**Release readiness:** **BLOCKED** — manual physical-device VPN lifecycle and stability evidence is still required.

## Current validation snapshot — 2026-09-17
- Development APK CI is **GREEN** after the current DNS/blocklist/privacy hardening batch: SWIR progress SVG consistency, privacy/network manifest gate, lint, unit tests + deterministic benchmark, APK build/package validation, ZIP integrity and SHA-256 all passed.
- Deterministic offline DNS ad fixture coverage: **100.0% (96/96)**.
- Benign DNS control false positives: **0/20**.
- Bundled offline starter list: **95 high-confidence domains**, with larger maintained lists loaded at runtime.
- DNS parser hardening is GREEN: rejects IPv4 fragments, inconsistent IP/UDP lengths, response packets, non-standard opcodes, ambiguous multi-question DNS messages and invalid source port 0.
- Upstream DNS response validation rejects mismatched question/name/type/class, malformed responses and truncated replies.
- Upstream DNS health scoring is GREEN: failure cooldown/half-open recovery remains bounded, persistently slow but successful resolvers are demoted without being marked failed, and stale latency-only penalties now decay after long idle periods so a Wi-Fi ↔ mobile transition does not keep biasing a new network with old RTT history.
- Stale-latency aging never clears circuit-breaker failure state: a failed resolver still requires its bounded half-open recovery probe after cooldown.
- Blocklist update hardening evaluates **normalized unique-domain counts**, preventing a duplicate-inflated remote feed from passing minimum-size or same-mode anti-shrink checks.
- Privacy hardening: Android backup is disabled for local xADKiller state; cleartext traffic remains disabled; CI enforces these invariants and rejects QUERY_ALL_PACKAGES.
- Release remains blocked until manual-device VPN lifecycle, Wi-Fi/mobile transitions, sleep/wake, real-app behavior and longer stability checks are satisfactory.

## Release gate
No Release until all relevant build, lint, regression, stability, privacy, DNS/VPN lifecycle, blocklist integrity and manual-device checks are green and there are no known critical issues.

## Core priorities
- Harden VPN lifecycle and heartbeat so UI/service state cannot drift.
- Improve DNS blocking accuracy without routing all user traffic through the VPN.
- Add safer upstream DNS fallback/health scoring and diagnostics.
- Improve blocklist quality, deduplication, corruption handling and offline fallback.
- Keep memory bounded with large lists and avoid UI/service ANRs.
- Improve false-positive recovery and per-domain controls.
- Add stronger diagnostics for Private DNS / DoH conflicts and unsupported traffic classes.
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
- VPN start/stop/restart/boot lifecycle regression coverage where possible.
- Parser/blocklist regression fixtures, including duplicate-inflated update rejection.
- DNS packet malformed/fragmented/query-shape regression fixtures.
- DNS upstream failover/half-open recovery, persistent-slow-resolver recovery and stale-latency aging tests across simulated network-idle transitions.
- Memory/large-list stress checks.
- Manual device tests for Wi-Fi ↔ mobile data, sleep/wake and longer VPN stability.
- No Release from this branch until manual Android device validation is also satisfactory.
