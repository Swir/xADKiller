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

The three production-v1 feeds are dated 2026-09-13 and exceed the 45-day runtime policy. The three parallel-v2 feeds are dated 2026-09-18 and expired on 2026-10-18. Adding this audit detects that unresolved maintenance issue; it does not refresh those rules. A failing live audit is expected until a reviewed compatible data update is published. Unit tests of the auditor must still pass.

Generated local reports are written to `feed-audit-report/`; do not commit them as fresh source data.

