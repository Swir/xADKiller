# xADKiller Chrome Roadmap

## Stable line

- **v1.4.0 TITAN** — current Chrome Web Store submission baseline.
- Keep `main` stable while new blocking experiments are developed on feature branches.

## v1.5.0 — Adaptive Memory & Stability

Status: **in development / hardening** on `chrome-v150-adaptive-memory`.

<img width="100%" src="../assets/readme/chrome/progress-mini.svg" alt="xADKiller Chrome v1.5.0 roadmap progress" />

**Development progress:** **73.1% — 19/26 verified roadmap items.**  
**Release readiness:** **BLOCKED** — manual browser/beta validation and the remaining hardening items are not complete.

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

- [ ] Re-rank static rule selection using source agreement + resource-type coverage.
- [ ] Deduplicate equivalent domain/path rules across static, dynamic and session layers.
- [x] Add a rule-budget dashboard for STANDARD/ULTRA/TITAN Boost.
- [x] Measure startup cost, memory use and DOM scan time in CI as a reproducible performance budget.

### Phase 4 — Live Shield hardening

- [ ] Add feed schema versioning and explicit expiry metadata to the published data contract.
- [x] Reject stale or malformed feed payloads without replacing a known-good cache.
- [x] Add deterministic feed checksums in the repository.
- [ ] Add rollback metadata for bad rule-data releases.

### Phase 5 — Store beta

- [x] Produce a tested beta ZIP from green CI.
- [ ] Local benchmark and real browsing test.
- [x] Add and stabilize a broader real-page mutation/performance soak without weakening tests.
- [ ] Merge to `main` only after user approval.
- [ ] Publish v1.5.0 update to Chrome Web Store.

## Release gate

No merge or release based only on the 73.1% development counter or a green build. The release gate also requires the remaining functional/performance items, benchmark/integrity gates and manual browser regression validation to pass without known critical issues.

## Later

- Firefox port based on the stable Chrome engine after the Chrome line is satisfactory.