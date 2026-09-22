# xADKiller Live Shield

Official **data-only** protection channel for **xADKiller Browser**.

- `xadkiller-live-shield.json` contains domains, signatures and cosmetic protection data depending on the published feed role/ref.
- `xadkiller-titan-feed.json` contains TITAN signature data only.
- `feed-checksums.json` records the exact production feed refs, versions, timestamps and Git blob hashes used by the development integrity gate.
- The extension periodically checks approved feeds and validates them before applying updates.
- No JavaScript, WebAssembly or remotely executable code is downloaded from these feeds.
- `STANDARD` uses the conservative data subset; `ULTRA` may enable additional verified data.
- The extension keeps a validated local cache and falls back safely if GitHub is temporarily unavailable or a replacement feed is rejected.

## Integrity model

The v1.5 development CI performs two separate checks:

1. **Feed Guard regression tests** verify schema, freshness, size/shape and anti-shrink behavior without replacing known-good data on failure.
2. **Production feed checksum audit** fetches the exact approved GitHub payloads listed in `feed-checksums.json`, recomputes their Git blob SHA-1 values and verifies feed version/timestamp/data-only declarations.

The checksum manifest is an audit/integrity mechanism, not executable update code and not a digital-signature claim. Runtime JavaScript remains packaged inside the Chrome extension submitted through the Chrome Web Store.

## Updating protection data

1. Edit the appropriate data feed on its approved source ref.
2. Increment `feed_version` and `updated_at`.
3. Keep the payload data-only and within the supported schema.
4. Update `feed-checksums.json` to the exact reviewed Git blob hash/metadata when that feed becomes the approved production payload.
5. Run the Chrome TITAN CI and require both Feed Guard and production checksum audit to pass before relying on the changed feed.

**BY SWIR**
