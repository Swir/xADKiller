# xADKiller Live Shield

Official data channel for **xADKiller Browser**.

- `xadkiller-live-shield.json` contains domain intelligence only.
- The extension periodically checks this file and validates it before applying updates.
- No JavaScript, WebAssembly or remotely executable code is downloaded from this feed.
- `STANDARD` uses `standard_domains`.
- `ULTRA` uses both `standard_domains` and `ultra_domains`.
- The extension keeps a validated local cache and falls back safely if GitHub is temporarily unavailable.

## Updating the feed

1. Edit `xadkiller-live-shield.json`.
2. Increment `feed_version` and `updated_at`.
3. Keep entries as hostnames only.
4. Run Chrome Shield CI before publishing a browser release that depends on major feed changes.

**BY SWIR**
