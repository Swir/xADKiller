# Maintenance review

Follow the [SWIR repository review checklist](https://github.com/Swir/.github/blob/main/REPOSITORY_REVIEW_CHECKLIST.md) for functional maintenance.

## Production data is a required review area

The shipped consumer determines the endpoint. Live Shield uses the `live-shield-feed` ref, Live Matrix and TITAN use `main`, while the parallel v2 channel is listed in `browser-intelligence/feed-v2-production-channel.json`. Inspect the consumer in the relevant release, because development and store packages may differ.

The production checksum manifest proves payload identity; it does not prove freshness. The runtime Feed Guard accepts at most 45-day-old data and v2 expiry must still be in the future. Keep the audit policy aligned with runtime policy when either changes.

Run:

```sh
python -m unittest discover -s ci/tests -p test_feed_freshness.py -v
python ci/audit_feed_freshness.py
```

The read-only **Protection feed freshness** workflow runs daily at 07:17 UTC, on relevant main/PR changes and manually. It fetches all three v1 production roles and all three published parallel-v2 roles, compares payload hashes and metadata, checks age/expiry, and preserves JSON/Markdown evidence even on failure. Warnings begin at 30 days of age or seven days before expiry. HTTP, parsing and configuration errors fail verification. It does not publish or modify feeds, binaries or store packages.

Use the Actions job summary and `protection-feed-freshness` artifact to diagnose failures. Scheduled runs depend on GitHub Actions availability and repository scheduling settings.

## Resolve findings before declaring protection up to date

1. Review the actual upstream sources, changes, licenses and supported rule syntax.
2. Review changes to domains, signatures and selectors, including false-positive risks. Do not simply bump dates or relax age checks.
3. Validate the appropriate v1/v2 consumer and test both blocking and normal browsing, including login, checkout and media.
4. Update the appropriate source ref and the exact checksum/provenance manifests together. Preserve rollback and compatible delivery for existing users.
5. Rebuild bundled static lists when required; the Live Shield button does not rebuild the extension's packaged rules.
6. Verify the published feed and artifact after upload, then run the freshness audit again.

## Baseline finding: 2026-11-05

The initial audit found all three production-v1 feeds dated 2026-09-13 beyond the 45-day runtime policy, plus three expired parallel-v2 feeds. The reviewed 2026.11.05.1 update refreshes all three stable endpoints with compatible schema-v1 data. The parallel schema-v2 snapshot is 2026.11.05.2, with a 30-day lifetime and rollback metadata referring to the refreshed v1 generation. Exact hashes, source provenance and changes are in `browser-intelligence/feed-review-2026-11-05.json` and the checksum/channel manifests.

The data change adds three corroborated ad-network domains and two Prebid script signatures, removes two broad business/login API domains and four generic content-path signatures, and narrows TITAN's generic path rules to third-party requests. Existing cosmetic selectors remain unchanged. This is a runtime data refresh, not a new store binary or a rebuild of users' bundled static lists.

`node browser-extension/tests/production-feed-update.mjs` verifies exact publication hashes, recovery from `stale_feed` for all three roles, preserved old-cache count thresholds, v1-to-v2 acceptance, actual Matrix/TITAN rule generation in both modes, and 40 blocking/normal-request fixtures. It is a deterministic request-level regression, not evidence of interactive login, payment or video playback on live sites. The current-time network audit remains separate and must pass after publication.

Installed opt-in beta packages still pin their original immutable v2 snapshot. Publishing refreshed parallel data does not silently change that beta pin or activate a beta session. Stable installed consumers use the refreshed v1 URLs; beta repinning requires a separately tested package update.

Generated local reports are written to `feed-audit-report/`; do not commit them as fresh source data.

