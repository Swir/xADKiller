# xADKiller Chrome Roadmap

## Stable line

- **v1.4.0 TITAN** — current Chrome Web Store submission baseline.
- Keep `main` stable while new blocking experiments are developed on feature branches.

## v1.5.0 — Adaptive Memory & Stability

Status: **in development / hardening** on `chrome-v150-adaptive-memory`.

<img width="100%" src="../assets/readme/chrome/progress-mini.svg" alt="xADKiller Chrome v1.5.0 roadmap progress" />

**Development progress:** **80.8% — 21/26 verified roadmap items.**  
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

- [x] Re-rank static rule selection using source agreement + resource-type coverage. STANDARD now builds a cross-source agreement map across EasyList, EasyPrivacy and AdGuard inputs, rewards independently corroborated signals plus useful request-type coverage, preserves each source's contribution budget by backfilling past duplicates, and records the quality model in build metadata. A deterministic CI regression validates the ranking rules before Chromium tests run.
- [x] Deduplicate equivalent domain/path rules across static, dynamic and session layers. The build now performs a deterministic semantic cross-layer pass: ULTRA drops STANDARD-equivalent rules, dynamic intelligence drops domains already covered by static layers, and TITAN session rules drop static-equivalent conditions. CI fails if those overlaps return.
- [x] Add a rule-budget dashboard for STANDARD/ULTRA/TITAN Boost.
- [x] Measure startup cost, memory use and DOM scan time in CI as a reproducible performance budget.
- [x] Convert the 2026-09-18 manual browser-test misses into a risk-tiered regression fixture instead of benchmark-only overfitting. High-confidence ad/tracker hosts are third-party-only in STANDARD, privacy-sensitive consent/support/attribution/experimentation hosts are ULTRA-only, and playback, cloud-routing, feature-flag and checkout/fraud infrastructure remains explicitly excluded from blanket host blocking. The final Chromium gate covers **61/61 STANDARD-core**, **61/61 ULTRA-core**, **23/23 ULTRA-aggressive** hosts and verifies **0/11 risky blanket promotions** without changing the 21/26 development counter.

### Phase 4 — Live Shield hardening

- [ ] Publish/migrate protection feeds to the v2 data contract with explicit expiry metadata. Feed Guard supports v1 for current production compatibility and validates v2 `expires_at` with bounded lifetime/expiry checks. The development service worker places a local `feed-v2-compat` adapter **after Feed Guard**, so a fully validated v2 payload can be consumed by the current v1-shaped Live Matrix/TITAN readers without weakening validation. A deterministic migration preflight re-fetches the exact pinned production v1 blobs, verifies their Git blob SHA-1 and metadata, constructs planned v2 candidates without changing protection payloads, checks expiry/rollback safety, rejects executable-looking data keys, and can emit local candidate JSON with `npm run build:feed-v2-candidates`. This item stays open until the published production feeds are actually migrated.
- [x] Reject stale, malformed, replayed, unauthorised-downgraded or structurally unsafe feed payloads without replacing a known-good cache. The transport layer pins approved raw GitHub paths, GET-only/no-credentials/no-referrer requests, rejects redirects/provenance drift, validates declared `Content-Length`, and independently buffers the actual response stream with a hard 2 MiB ceiling so missing/lying length headers or transparent decompression cannot bypass the limit. The same 15-second timeout remains active until the protected response body is completely consumed, preventing a server from sending headers quickly and then stalling the MV3 worker. Public feed requests force `cache: no-store` and replace arbitrary caller headers with an Accept-only public-data header set, preventing Authorization/Cookie/API-key/debug secrets from hitchhiking to GitHub while leaving xADKiller's separately validated known-good cache as the only offline fallback. Existing numeric `?v=<timestamp>` cache-busters are accepted only as legacy local syntax and are stripped before network I/O; arbitrary query strings and fragments on approved feed paths are rejected, so GitHub receives one canonical protected URL per feed. Successful responses must use approved data media types (`application/json`, raw `text/plain` or `application/octet-stream`); HTTP error bodies remain visible to Feed Guard so 429/5xx and `Retry-After` handling are preserved. A separate canonical data-only contract enforces the exact schema-v1/v2 top-level field set, v2 rollback object shape, per-list collection bounds, canonical domain syntax, semantic duplicate DNR/TITAN rule rejection, DNR resource types/fields, safe cosmetic selectors and compiled TITAN regex/path/token structures before Feed Guard accepts the response. TITAN regex data is additionally rejected when it contains backreferences or unbounded nested quantifiers that can create pathological backtracking/ReDoS; bounded production patterns remain accepted. Feed Guard then enforces schema/time/anti-shrink plus a local immutable high-water mark: older unrelated payloads, same-timestamp version collisions, version reuse at a newer timestamp and schema-v1 downgrade after v2 are rejected. A rollback to the exact `rollback.previous_version` advertised by the accepted v2 feed remains allowed while preserving the v2 high-water mark. Dedicated CI gates cover canonical URL handling, transport timeout/MIME/provenance/declared-and-streamed size, request secret stripping/no-store policy, strict payload schema/bounds/dedupe/ReDoS, cache fallback, retry/backoff and state transitions.
- [x] Add deterministic feed checksums in the repository.
- [ ] Publish rollback metadata for bad rule-data releases. Feed Guard validates v2 `rollback.previous_version` + safe repository-relative `previous_ref`, the v2 consumer adapter preserves those fields, and the migration preflight verifies each planned rollback target against the exact pinned production feed. This item stays open until that metadata exists in the published production feeds.

### Phase 5 — Store beta

- [x] Produce a tested beta ZIP from green CI.
- [ ] Local benchmark and real browsing test. The first user-run domain dashboard exposed misses and is now preserved as the risk-tiered Chromium regression above; this item stays open until the refreshed development package is re-tested in normal browsing and the manual result is satisfactory.
- [x] Add and stabilize a broader real-page mutation/performance soak without weakening tests.
- [ ] Merge to `main` only after user approval.
- [ ] Publish v1.5.0 update to Chrome Web Store.

## Release gate

No merge or release based only on the 80.8% development counter or a green build. The release gate also requires the remaining functional/performance items, benchmark/integrity gates and manual browser regression validation to pass without known critical issues. The v2 migration preflight is a safety gate only; it does not count as production feed publication.

## Later

- Firefox port based on the stable Chrome engine after the Chrome line is satisfactory.
