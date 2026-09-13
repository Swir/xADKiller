# xADKiller Live Shield

This branch is the data channel for xADKiller Browser's **Live Shield**.

- The extension downloads `xadkiller-live-shield.json` periodically.
- The feed contains **data only** (domain names). It does not contain JavaScript, WASM or remotely executed code.
- Blocking logic stays inside the reviewed extension package.
- `STANDARD` uses `standard_domains`.
- `ULTRA` uses both `standard_domains` and `ultra_domains`.
- The extension validates the schema, normalizes domains, caps the number of entries and falls back to its packaged intelligence if the feed is unavailable.

## Updating

Edit `xadkiller-live-shield.json`, increment `feed_version`, update `updated_at`, then run the extension CI before using the new feed for a release.

**BY SWIR**
