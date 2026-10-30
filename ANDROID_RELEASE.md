# xADKiller Android 1.6.0

This is the Android release line on `android-stable`, based on the existing
`android-v160-mega` development. Physical-phone qualification is pending until
the release candidate is checked by the owner. A prerelease is not Stable.

## Improvements

- Temporary DNS pause for 5 or 15 minutes, automatic expiry and explicit resume.
  The local VPN stays alive and forwards DNS during the pause. The optional
  Smart Engine has separate controls.
- View and remove individual allow/block rules. Recent local DNS blocks can be
  allowed after confirmation, including subdomains, without turning off protection.
- Cancelled VPN startup cannot establish a late tunnel or clean up a newer session.
  Closing a session also closes its active upstream socket.
- Blocking tunnel reads avoid idle spinning. A separate heartbeat reports idle
  liveness. Physical network changes reset outdated resolver health penalties.
- Returning to the dashboard retains session counters and the loaded blocklist.
  Downloads no longer hold the blocklist monitor while doing network IO; rule
  changes and cache recovery run away from the UI thread.
- The primary protection control comes before diagnostics. PL/EN quick actions,
  boot-autostart control, clear pause state and Android 15+ system-bar spacing.
- The production APK uses `com.swir.xadkiller`, is not debuggable, and is signed
  with a private release key. The public repository's old debug key is not used.

## Install / upgrade

Android 8.0 or newer. Download the signed APK from this release, verify SHA-256
against `SHA256SUMS.txt`, open it on the phone and allow installation from the
chosen browser/file manager when Android asks. Grant VPN consent to enable DNS
filtering; notification and optional Accessibility permissions have separate prompts.

The older public 1.5.1 package was `com.swir.xadkiller.debug`, signed with a public
test key. This production app installs separately. Disable the old app's VPN and
Smart Engine before using this one. Existing debug-app settings do not migrate
automatically. Subsequent production updates must use the same private release key.

## Phone check before Stable

1. Enable protection, open a few normal sites/apps and confirm internet works.
2. Update STANDARD lists. Confirm the list count grows and protection stays active.
3. Switch Wi-Fi → mobile → Wi-Fi; check normal browsing and new DNS block events.
4. Lock the screen for 5–10 minutes, unlock and verify protection and internet.
5. Stop/start protection several times. Test pause and resume. Add `example.com`
   as a block rule, then allow it, then remove the exception. Normal access should return.
6. Restart the phone with autostart enabled, unlock it and verify protection.
7. Use normal apps for longer, and report crashes, broken content or unusual battery use.

Report phone model, Android version and which checks passed. Do not send browsing
history, diagnostic logs or account information unless necessary for a specific bug.

## Rebuild and verify

Java 17, Gradle 8.9, Android platform/build-tools 35:

```sh
gradle --no-daemon testDebugUnitTest testReleaseUnitTest lintRelease assembleRelease
gradle --no-daemon testDebugUnitTest --tests com.swir.xadkiller.BlocklistLargeListQualificationTest -PxadkillerLargeListQualification=true
python3 ci/validate_android_release.py
```

`app/build/outputs/apk/release/app-release-unsigned.apk` intentionally lacks a
private key. Align/sign with the owner's release key using Android build-tools
`zipalign` / `apksigner`, then verify with `apksigner verify --verbose --print-certs`.
Never commit private signing material or upload it as a public release asset.

The workflow `Android release qualification` runs unit tests, the 750,000-domain
memory gate, release lint/package checks and actual TUN/DNS integration tests on
Android API 29 and 35. An additional local emulator may cover newer Android.
Emulator evidence does not stand in for physical Wi-Fi/mobile or OEM battery behavior.

## Privacy and limits

DNS filtering runs on-device, without a remote VPN relay. Allowed DNS questions
are sent as ordinary unencrypted DNS to the adaptive resolver pool (Cloudflare,
Quad9, Google); these providers can see those questions and the public source IP.
Downloading public blocklists contacts their publishers. Optional Community
Intelligence downloads data rules. There is no required xADKiller telemetry server.

The optional Accessibility Smart Engine inspects on-screen accessibility content
locally to identify explicit ad controls, skip them or mute audio according to the
user's settings. It is not required for DNS filtering. Domain/activity diagnostics
remain local; Android cloud backup and device-transfer export are disabled.

DNS filtering cannot remove every in-app/video ad, first-party ads sharing content
domains, cached responses, or application-specific encrypted DNS. Strict Android
Private DNS can bypass/conflict with the local DNS path; diagnostics explain this.
Android permits only one active VPN per user. This app is a DNS filter, not a
traffic-encrypting VPN. Current metadata targets API 35; no Play Store release is claimed.
