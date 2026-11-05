# xADKiller maintenance

For a maintenance review, read [docs/MAINTENANCE_REVIEW.md](docs/MAINTENANCE_REVIEW.md) and the current source/release manifests.

- Run `python ci/audit_feed_freshness.py` against the current published feeds. Record failures; do not call protection data current while this check fails.
- Review upstream EasyList, EasyPrivacy, AdGuard and HaGeZi sources and the consumers used by the actual shipped Chrome/Firefox/Android version. Live Shield refresh and rebuilding bundled static lists are different operations.
- Use the current date for freshness. Preserve data-only delivery, schema compatibility, cache fallback, anti-shrink/rollback checks and the current runtime age/expiry limits.
- Update rule data only after reviewing its sources and testing blocking plus representative normal browsing. Changing timestamps alone is not a validated update.
- Inspect release workflow triggers before pushing. Keep source-data maintenance separate from store publication; verify the exact tagged artifact and its checksums.
- For a maintenance report, cover source/dependencies, data freshness, update behavior, functional tests, releases and screenshots. Mark unresolved items explicitly.

