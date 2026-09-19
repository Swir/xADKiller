# xADKiller Android v1.6.0 — Mega Development Roadmap

This branch develops the Android APK independently from the current stable 1.5.1 line.

<img width="100%" src="assets/readme/android/progress-mini.svg" alt="xADKiller Android v1.6.0 roadmap progress" />

**Development progress:** **58.3% — 7 / 12 verified v1.6 development items.**  
**Release readiness:** **BLOCKED** — manual physical-device VPN lifecycle and stability evidence is still required.

## Canonical v1.6 development scope

The checklist below is the finite denominator for Android v1.6 development progress. It measures implemented/verified engineering scope; release readiness remains a separate manual-device gate.

- [x] Local no-root DNS filtering through Android VpnService remains functional without routing ordinary user traffic through a remote xADKiller VPN.
- [x] DNS packet integrity/privacy hardening covers exact IPv4/UDP framing, malformed queries/responses, EDNS privacy scrubbing/clamping and incoming/synthesized UDP checksums with regression fixtures.
- [x] Adaptive upstream DNS health/fallback implements bounded cooldown, half-open recovery, single emergency fallback, stale-latency aging, RTT spike damping and fresh network/session latency epochs with tests.
- [x] Blocklist/update handling keeps a known-good offline/cache path, conservative high-confidence starter coverage and fail-closed corruption/incomplete-update behavior.
- [x] Private DNS diagnostics distinguish supported system states while explicitly refusing unsupported per-app DoH detection claims.
- [x] Privacy/platform hardening keeps cleartext disabled, local protection state out of Android backup, no TLS MITM, no remote executable update path and no required telemetry backend.
- [x] Automated development gates cover Gradle build/lint/unit tests, manifest/privacy checks, deterministic DNS fixtures, APK integrity/checksum and SWIR progress consistency.
- [ ] Complete the v1.6 dashboard/status/recovery UX pass, including clear VPN, DNS, blocklist, Smart Engine and last-update state without regressions in PL/EN.
- [ ] Complete large-list memory/ANR stress qualification with explicit bounded-memory evidence on the supported Android scope.
- [ ] Complete physical-device VPN lifecycle validation across start/stop/restart, package replacement, idle, sleep/wake and Wi-Fi ↔ mobile transitions.
- [ ] Complete longer physical-device/real-app stability and false-positive recovery regression testing.
- [ ] Complete the final v1.6 release gate: all automated/manual checks green, no known critical blockers, verified release artifact and promotion of the tested candidate.


## Current validation snapshot — 2026-09-18
- Development APK CI is **GREEN** after the DNS privacy/integrity and conservative offline-blocking hardening batch: SWIR progress SVG consistency, privacy/network manifest gate, lint, DNS framing/EDNS0 privacy scrub/EDNS UDP-size clamp/incoming + synthesized UDP-checksum regression, dedicated offline starter-list coverage, full unit tests + deterministic benchmark, APK build/package validation, ZIP integrity and SHA-256 are required gates on this branch.
- Deterministic offline DNS ad fixture coverage: **100.0% (127/127)**.
- Benign DNS control false positives: **0/20**.
- Bundled offline starter list: **126 high-confidence domains**, with larger maintained lists loaded at runtime. The 2026-09-18 expansion reuses only high-confidence cross-platform ad/tracker misses from manual Chrome validation; consent, playback, feature-flag and checkout/fraud infrastructure remains deliberately excluded from the offline starter list.
- DNS parser hardening requires the IPv4 payload to contain exactly one complete UDP datagram and rejects IPv4 fragments, inconsistent IP/UDP lengths, response packets, non-standard opcodes, ambiguous multi-question DNS messages and invalid source port 0. This prevents unexplained trailing IPv4 payload from being silently ignored by the DNS parser.
- Incoming IPv4 DNS datagrams verify every **non-zero UDP checksum** before parsing or forwarding; the legal IPv4 zero-checksum form remains accepted as “checksum not supplied” for compatibility. Dedicated regressions prove a valid non-zero checksum is accepted and a one-byte DNS corruption is rejected while framing remains otherwise valid.
- Synthesized DNS replies carry a real IPv4 UDP checksum over the pseudo-header plus complete UDP payload instead of relying on the legal-but-weaker IPv4 zero-checksum convention. A dedicated regression verifies the wire checksum and proves a one-byte payload corruption invalidates it.
- EDNS(0) forwarding strips **Client Subnet (option 8)** and **COOKIE (option 10)** from validated intercepted queries before they are sent to xADKiller's public upstream resolver pool. It also clamps an oversized advertised EDNS UDP payload to **1232 bytes** while preserving smaller client-advertised sizes, the OPT record, DNSSEC OK flag and other structurally valid options. This reduces fragmentation exposure during Wi-Fi/mobile path changes without discarding compatible EDNS metadata.
- Upstream DNS response validation rejects mismatched question/name/type/class, malformed receive lengths and DNS responses carrying the TC (truncated) flag so the resolver pool can fail over instead of forwarding an incomplete UDP answer.
- Upstream DNS response framing validates every declared answer/authority/additional resource record with a bounded record count, backwards-only compressed owner pointers, exact RDATA bounds and no undeclared trailing bytes. Claimed-but-missing or partially truncated records are rejected before they can enter the VPN tunnel.
- Upstream DNS health scoring is GREEN: failure cooldown/half-open recovery remains bounded, persistently slow but successful resolvers are demoted without being marked failed, and stale latency-only penalties decay after long idle periods so old RTT history cannot bias a later network path indefinitely.
- Resolver circuit breakers now change the **actual per-query attempt set**: cooling failed resolvers are omitted while healthy capacity exists, only one expired resolver is admitted as the half-open recovery probe, and an all-cooling pool exposes just one earliest-recovery emergency attempt instead of retrying every failed provider on each DNS query. This bounds avoidable latency during provider outages while retaining a controlled recovery path.
- A signalled network-epoch transition (for example a newly established protection session after Wi-Fi/mobile path change) now releases **old-path cooldown timers** into the existing single half-open probe gate while preserving lifetime success/failure counters and failure streaks. This prevents a resolver failure learned on the previous path from suppressing that resolver for up to a minute on the new path, without declaring every failed resolver healthy or probing the whole failed pool at once. Physical-device live handover behavior remains a manual release gate.
- Every newly established v1.6 VPN protection session starts a **fresh DNS latency epoch**: RTT EWMA, slow-response penalties and the outlier baseline are reset to neutral while lifetime counters and failure evidence are preserved; any stale cooldown from the previous path is re-armed through the bounded half-open probe policy rather than carried forward unchanged.
- Established healthy resolvers dampen a **single valid-but-extreme RTT spike** before it enters the EWMA while still counting the real sample toward the slow-response streak; one scheduler/radio/handover stall therefore cannot pin adaptive DNS timeouts near their maximum, while repeated slowness is still penalized.
- Stale-latency aging never clears circuit-breaker failure state. An explicit network-epoch transition may release an old-path cooldown, but the resolver remains failed and still requires the bounded half-open recovery probe.
- VPN service status has a **traffic-independent 5-second heartbeat** while the TUN worker is alive, so an idle connection no longer depends on DNS packet traffic to keep UI/service liveness fresh; the scheduler is shut down with the VPN/service lifecycle.
- VPN lifecycle policy now distinguishes boot preference from update continuity: `BOOT_COMPLETED` follows the autostart setting, while `MY_PACKAGE_REPLACED` resumes protection only when it was actually running before the app update — even if boot autostart is disabled. This prevents a Play/APK update from silently turning off a manually-started VPN without changing the user's boot preference.
- Private DNS diagnostics distinguish an established STRICT resolver from a STRICT resolver that is configured but not currently established, and surface a separate notice when Android reports an active network with zero DNS servers. The latter remains a non-fatal handover/captive-portal signal instead of being misreported as a healthy local DNS path. Per-app DoH remains explicitly **not reliably detectable** from Android system Private DNS APIs.
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
- VPN start/stop/restart/boot lifecycle regression coverage where possible; package-update regression must preserve a previously-running VPN independently of the boot-autostart preference, while physical-device validation remains required for the heartbeat and OS lifecycle transitions.
- Parser/blocklist regression fixtures, including duplicate-inflated update rejection and the conservative screenshot-derived cross-platform starter-list coverage gate.
- DNS packet malformed/fragmented/query-shape/exact IPv4↔UDP length regression fixtures.
- EDNS(0) privacy/stability regression: Client Subnet and COOKIE must be removed before upstream forwarding, advertised UDP payloads above 1232 must be clamped to 1232, smaller values must remain unchanged, and the OPT record, DO flag and unrelated well-framed options must remain intact.
- Incoming DNS UDP checksum regression: accept the legal zero-checksum IPv4 form, verify a valid non-zero checksum and reject corrupted datagrams when a checksum is present.
- Synthesized DNS response UDP checksum regression, including pseudo-header verification and corruption detection.
- DNS upstream response regression fixtures including TC=1 truncated UDP rejection, declared RR framing, truncated RDATA, invalid forward owner-name compression pointers and undeclared trailing-byte rejection.
- DNS upstream failover/half-open recovery, cooldown-attempt suppression, all-cooling single emergency fallback, persistent-slow-resolver recovery, one-off RTT spike dampening, stale-latency aging and explicit network-epoch reset tests. The reset must clear latency-only state, preserve failure history/lifetime counters and re-arm old-path cooldown through one bounded half-open recovery probe instead of clearing failures or carrying the stale cooldown unchanged.
- Private DNS diagnostic classification fixtures: established STRICT conflict, configured-but-unestablished STRICT resolver, automatic encrypted DNS, Private DNS off with reported resolvers, zero-reported-resolver handover/captive-portal notice, unknown/specifier fallback and no-network state; app-level DoH remains explicitly non-detectable by this system-level check.
- Memory/large-list stress checks.
- Manual device tests for Wi-Fi ↔ mobile data, sleep/wake and longer VPN stability.
- No Release from this branch until manual Android device validation is also satisfactory.
