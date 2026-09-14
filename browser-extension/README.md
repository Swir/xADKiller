# xADKiller Browser

Manifest V3 browser extension for Chrome/Chromium and Firefox.

## Protection layers

- DeclarativeNetRequest network blocking with a bundled core ruleset.
- Local cosmetic filtering for obvious ad containers.
- Conservative Smart Auto-Skip for explicit “Skip Ad” buttons in English, Polish, Spanish, German and French.
- Per-site allowlist.
- Global on/off switch.
- No remote code, no telemetry, no account, no cloud processing.

## Build

```bash
npm install
npm run build
npm run validate
```

Chrome/Chromium output: `dist/chrome`  
Firefox output: `dist/firefox`

## Local testing

Chrome: load `dist/chrome` using `chrome://extensions` → Developer mode → Load unpacked.

Firefox: use `npm exec web-ext run -- --source-dir dist/firefox` for temporary development installation.

## Store packages

The CI workflow creates:
- `xADKiller-Chrome-v1.0.0.zip` — ready to upload to Chrome Web Store.
- `xADKiller-Firefox-v1.0.0.zip` — ready to submit to addons.mozilla.org (AMO).

Firefox permanent installation requires Mozilla/AMO signing. The package declares a stable Gecko ID and `data_collection_permissions.required = ["none"]`.

## Privacy

xADKiller Browser stores settings locally in the browser. It does not transmit browsing history, page content, credentials, search terms or analytics.
