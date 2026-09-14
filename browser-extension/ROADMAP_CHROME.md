# xADKiller Chrome Roadmap

## Stable line

- **v1.4.0 TITAN** — current Chrome Web Store submission baseline.
- Keep `main` stable while new blocking experiments are developed on feature branches.

## v1.5.0 — Adaptive Memory & Stability

Status: **in development** on `chrome-v150-adaptive-memory`.

### Phase 1 — Adaptive Memory

- [x] Persist only high-confidence learned third-party ad/tracker hosts.
- [x] Do not persist full page URLs, request paths or originating page domains.
- [x] Require repeated observation before a learned host becomes persistent.
- [x] 21-day TTL and bounded memory size.
- [x] Rehydrate learned protection after browser restart.
- [x] Collision-safe learned-rule allocation.
- [x] User-facing reset for network learning.
- [x] PL/EN diagnostics in the popup.
- [ ] Full Chromium CI green.

### Phase 2 — Breakage Guard

- [ ] Add one-click temporary protection pause for the current site.
- [ ] Add a local breakage recovery mode that disables only heuristic layers before disabling core DNR.
- [ ] Track false-positive rollbacks locally without telemetry.
- [ ] Add regression fixtures for login, checkout and embedded-media pages.

### Phase 3 — Better filtering efficiency

- [ ] Re-rank static rule selection using source agreement + resource-type coverage.
- [ ] Deduplicate equivalent domain/path rules across static, dynamic and session layers.
- [ ] Add a rule-budget dashboard for STANDARD/ULTRA/TITAN Boost.
- [ ] Measure startup cost, memory use and DOM scan time in CI.

### Phase 4 — Live Shield hardening

- [ ] Add feed schema versioning and expiry metadata.
- [ ] Reject stale or malformed feed payloads without replacing a known-good cache.
- [ ] Add deterministic feed checksums in the repository.
- [ ] Add rollback metadata for bad rule-data releases.

### Phase 5 — Store beta

- [ ] Produce a tested beta ZIP from green CI.
- [ ] Local benchmark and real browsing test.
- [ ] Fix regressions without weakening tests.
- [ ] Merge to `main` only after user approval.
- [ ] Publish v1.5.0 update to Chrome Web Store.

## Later

- Firefox port based on the stable Chrome engine after the Chrome line is satisfactory.
