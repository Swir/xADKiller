# xADKiller — Android Ad & Tracker Blocker

**xADKiller by SWIR** is an open-source Android blocker that runs without root by using Android's local `VpnService` as a DNS filter.

## Features
- system-wide DNS ad/tracker blocking without root
- local VPN: traffic is not sent through a remote xADKiller VPN server
- Standard mode: StevenBlack + AdAway
- PRO mode: additionally uses HaGeZi Pro for wider blocking
- local block console with time, detected app/UID, package, blocked domain and rule source
- package links open the app in Google Play
- blocked-domain links require a warning before opening
- custom block / allow rules
- automatic list refresh and optional start after reboot
- GitHub link built into the app

## Privacy
The application has no advertising SDK, analytics SDK, user account or cloud log upload. Block logs stay in the app's private storage on the phone. Allowed DNS queries are forwarded to Cloudflare (1.1.1.1), Quad9 (9.9.9.9), or Google DNS (8.8.8.8).

The console can see DNS hostnames, **not full HTTPS URL paths**. Per-app UID attribution uses Android `ConnectivityManager.getConnectionOwnerUid()` when supported (Android 10 / API 29+).

## Limitations
DNS-level filtering cannot reliably remove ads delivered from the same hostname as wanted content. Apps using their own encrypted DNS/DoH can bypass DNS interception. xADKiller intentionally avoids invasive accessibility-based screen clicking or TLS man-in-the-middle certificates.

## Build
The repository contains a GitHub Actions workflow. Every push to `main` builds a debug APK and uploads it as the artifact **xADKiller-debug-apk**.

## Author
**SWIR** — https://github.com/Swir
