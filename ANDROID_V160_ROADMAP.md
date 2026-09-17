# xADKiller Android v1.6.0 — Mega Development Roadmap

This branch develops the Android APK independently from the current stable 1.5.1 line.

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
- Preserve privacy: no MITM, no remote executable code, no telemetry/profiling backend.

## UI / UX
- Refresh the dark TITAN dashboard with clearer protection state and health indicators.
- Keep PL/EN as the primary maintained languages for this development line.
- Add clearer status cards for VPN, DNS upstream, blocklists, Smart Engine and last successful update.
- Improve error reporting and one-tap recovery actions.

## Test plan
- Gradle compile + lint + unit tests in CI.
- Manifest and signing checks.
- APK integrity/checksum checks.
- VPN start/stop/restart/boot lifecycle regression coverage where possible.
- Parser/blocklist regression fixtures.
- DNS packet and NXDOMAIN response fixtures.
- Memory/large-list stress checks.
- No Release from this branch until manual Android device validation is also satisfactory.
