# xADKiller Chrome Roadmap

## Stable line

- **v1.4.0 TITAN** — current Chrome Web Store submission baseline.
- Keep `main` stable while new blocking experiments are developed on feature branches.

## v1.5.0 — Adaptive Memory & Stability

Status: **in development / hardening** on `chrome-v150-adaptive-memory`.

<img width="100%" src="../assets/readme/chrome/progress-mini.svg" alt="xADKiller Chrome v1.5.0 roadmap progress" />

**Development progress:** **88.5% — 23/26 verified roadmap items.**  
**Release readiness:** **BLOCKED** — manual browser/beta validation and the remaining store-release gates are not complete.

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
- Manual validation evidence: the 2026-09-18 browser-test misses are preserved as a risk-tiered regression fixture instead of benchmark-only overfitting. High-confidence ad/tracker hosts are third-party-only in STANDARD, privacy-sensitive consent/support/attribution/experimentation hosts are ULTRA-only, and playback, cloud-routing, feature-flag and checkout/fraud infrastructure remains explicitly excluded from blanket host blocking. The Chromium gate covers **61/61 STANDARD-core**, **61/61 ULTRA-core**, **23/23 ULTRA-aggressive** hosts and verifies **0/11 risky blanket promotions** without changing the authoritative roadmap scope.

### Phase 4 — Live Shield hardening

- [x] Publish/migrate protection feeds to the v2 data contract with explicit expiry metadata. The data-only schema-v2 channel is published side-by-side on the isolated `protection-feed-v2` branch at commit `0930f563b4a4bfdef67885988485bfa8c7646784`. `browser-intelligence/feed-v2-production-channel.json` pins the published ref/commit plus exact blob SHA-1 and byte size for Live Shield, Live Matrix and TITAN; each published feed carries bounded `expires_at` metadata. The development service worker keeps the v2 compatibility adapter after Feed Guard, and the production-channel contract verifies that this publication contains data only and does not alter the stable schema-v1 store endpoints. Consumer/store promotion remains a separate release gate.
- [x] Reject stale, malformed, replayed, unauthorised-downgraded or structurally unsafe feed payloads without replacing a known-good cache. The transport layer pins approved raw GitHub paths, GET-only/no-credentials/no-referrer requests, rejects redirects/provenance drift, validates declared `Content-Length`, and independently buffers the actual response stream with a hard 2 MiB ceiling so missing/lying length headers or transparent decompression cannot bypass the limit. The same 15-second timeout remains active until the protected response body is completely consumed, preventing a server from sending headers quickly and then stalling the MV3 worker. Public feed requests force `cache: no-store` and replace arbitrary caller headers with an Accept-only public-data header set, preventing Authorization/Cookie/API-key/debug secrets from hitchhiking to GitHub while leaving xADKiller's separately validated known-good cache as the only offline fallback. Existing numeric `?v=<timestamp>` cache-busters are accepted only as legacy local syntax and are stripped before network I/O; arbitrary query strings and fragments on approved feed paths are rejected, so GitHub receives one canonical protected URL per feed. Successful responses must use approved data media types (`application/json`, raw `text/plain` or `application/octet-stream`); HTTP error bodies remain visible to Feed Guard so 429/5xx and `Retry-After` handling are preserved. A separate canonical data-only contract enforces the exact schema-v1/v2 top-level field set, v2 rollback object shape, per-list collection bounds, canonical domain syntax, semantic duplicate DNR/TITAN rule rejection, DNR resource types/fields, safe cosmetic selectors and compiled TITAN regex/path/token structures before Feed Guard accepts the response. TITAN regex data is additionally rejected when it contains backreferences or unbounded nested quantifiers that can create pathological backtracking/ReDoS; bounded production patterns remain accepted. Feed Guard then enforces schema/time/anti-shrink plus a local immutable high-water mark: older unrelated payloads, same-timestamp version collisions, version reuse at a newer timestamp and schema-v1 downgrade after v2 are rejected. A rollback to the exact `rollback.previous_version` advertised by the accepted v2 feed remains allowed while preserving the v2 high-water mark. Dedicated CI gates cover canonical URL handling, transport timeout/MIME/provenance/declared-and-streamed size, request secret stripping/no-store policy, strict payload schema/bounds/dedupe/ReDoS, cache fallback, retry/backoff and state transitions.
- [x] Add deterministic feed checksums in the repository.
- [x] Publish rollback metadata for bad rule-data releases. All three published schema-v2 feeds on `protection-feed-v2` include a validated `rollback.previous_version` and safe repository-relative `rollback.previous_ref`. The production-channel manifest records the corresponding published feed versions, refs, exact blob identities and sizes, while Feed Guard retains the v2 high-water mark and only permits rollback to the explicitly advertised predecessor.

### Phase 5 — Store beta

- [x] Produce a tested beta ZIP from green CI.
- [ ] Local benchmark and real browsing test. The first user-run domain dashboard exposed misses and is now preserved as the risk-tiered Chromium regression above; this item stays open until the refreshed development package is re-tested in normal browsing and the manual result is satisfactory.
- [x] Add and stabilize a broader real-page mutation/performance soak without weakening tests.
- [ ] Merge to `main` only after user approval.
- [ ] Publish v1.5.0 update to Chrome Web Store.

## Release gate

No merge or release based only on the 88.5% development counter or a green build. The release gate still requires refreshed normal-browsing/manual beta validation, user approval for merge, store-safe promotion/rollback, and no known critical issues. The schema-v2 publication is deliberately parallel and data-only; it does not silently switch the stable store/main consumer.

## Later

- Firefox port based on the stable Chrome engine after the Chrome line is satisfactory.
