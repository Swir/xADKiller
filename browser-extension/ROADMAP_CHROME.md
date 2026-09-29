# xADKiller Chrome Roadmap

## Stable line

- **v1.4.0 TITAN** — previous Chrome Web Store submission baseline.
- **v1.5.0 Adaptive Memory & Stability** — development complete and user-validated on 2026-09-29; GitHub release promotion is authorized.
- Keep production protection feeds data-only and Manifest V3-compatible.

## v1.5.0 — Adaptive Memory & Stability

Status: **development complete / release promotion** on `chrome-v150-adaptive-memory`.

<img width="100%" src="../assets/readme/chrome/progress-mini.svg" alt="xADKiller Chrome v1.5.0 roadmap progress" />

**Development progress:** **100% — 25/25 engineering + manual acceptance items verified.**  
**Release readiness:** **READY FOR GITHUB RELEASE** — refreshed normal-browsing/manual beta validation was confirmed by the user on 2026-09-29 and merge approval was explicitly granted. Chrome Web Store publication remains a separate external distribution step and is not claimed here.

### Phase 1 — Adaptive Memory

- [x] Persist only high-confidence learned third-party ad/tracker hosts.
- [x] Do not persist full page URLs, request paths or originating page domains.
- [x] Require repeated observation before a learned host becomes persistent.
- [x] 21-day TTL and bounded memory size.
- [x] Rehydrate learned protection after browser restart.
- [x] Collision-safe learned-rule allocation.
- [x] User-facing reset for network learning.
- [x] PL/EN diagnostics in the popup.
- [x] Full Chromium CI green.

### Phase 2 — Breakage Guard

- [x] Add one-click temporary protection pause for the current site.
- [x] Add a local breakage recovery mode that disables only heuristic layers before disabling core DNR.
- [x] Track false-positive rollbacks locally without telemetry as an explicit Breakage Guard history/control.
- [x] Add regression fixtures for login, checkout and embedded-media pages.

### Phase 3 — Better filtering efficiency

- [x] Re-rank static rule selection using source agreement + resource-type coverage.
- [x] Deduplicate equivalent domain/path rules across static, dynamic and session layers.
- [x] Add a rule-budget dashboard for STANDARD/ULTRA/TITAN Boost.
- [x] Measure startup cost, memory use and DOM scan time in CI as a reproducible performance budget.
- [x] Preserve the 2026-09-18 manual misses as a risk-tiered Chromium regression fixture; current automated qualification keeps risky playback/cloud/feature-flag/checkout infrastructure out of blanket blocking.

### Phase 4 — Live Shield hardening

- [x] Publish/migrate protection feeds to the v2 data contract with explicit expiry metadata on the isolated data-only channel.
- [x] Reject stale, malformed, replayed, unauthorized-downgraded or structurally unsafe feed payloads without replacing a known-good cache.
- [x] Add deterministic feed checksums in the repository.
- [x] Publish rollback metadata for bad rule-data releases.

### Phase 5 — Release acceptance

- [x] Produce a tested beta ZIP from green CI.
- [x] Local benchmark and real browsing test — user confirmed the refreshed v1.5.0 package works great on 2026-09-29.
- [x] Add and stabilize a broader real-page mutation/performance soak without weakening tests.
- [x] User approval to merge and release — explicitly granted on 2026-09-29.
- [x] Store-safe/package-safe release metadata and version consistency completed for v1.5.0.

## Distribution status

- GitHub Release: authorized for `chrome-v1.5.0` after merge + post-merge verification.
- Chrome Web Store: **not yet claimed as published**; Google review/publication is tracked separately from development completion.

## Release gate

v1.5.0 development is complete. Promotion must still preserve exact-head green CI, merge cleanly to `main`, and verify the published GitHub artifact/tag. No statement here claims Chrome Web Store publication before it actually happens.

## Later

- Firefox port based on the stable Chrome engine after the Chrome line is satisfactory.
