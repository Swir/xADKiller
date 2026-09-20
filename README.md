<!-- SWIR-README-STANDARD:v2 -->

<div align="center">

# xADKiller

### Android APK + Chrome Manifest V3 protection by SWIR

![Chrome Stable](https://img.shields.io/badge/Chrome_stable-v1.4.0-02050A?style=for-the-badge&logo=googlechrome&logoColor=62E5FF)
![Android Stable](https://img.shields.io/badge/Android_stable-v1.5.1-02050A?style=for-the-badge&logo=android&logoColor=62E5FF)
![Chrome Dev](https://img.shields.io/badge/Chrome_dev-v1.5.0-07111C?style=for-the-badge)
![Android Dev](https://img.shields.io/badge/Android_dev-v1.6.0-07111C?style=for-the-badge)

**Privacy-first ad/tracker blocking on Android and Chrome — no remote executable feed code.**

</div>

## 📌 Current project status

`main` remains the stable/public baseline. Active Android and Chrome development is intentionally isolated on dedicated branches and open PRs so store/release code is not overwritten by unfinished work.

### Chrome — v1.5.0 development

<img width="100%" src="assets/readme/chrome/progress-card.svg" alt="xADKiller Chrome v1.5.0 development progress" />

| Item | Status |
|---|---|
| Stable public release | **chrome-v1.4.0 — TITAN** |
| Development branch | [`chrome-v150-adaptive-memory`](https://github.com/Swir/xADKiller/tree/chrome-v150-adaptive-memory) |
| Open PR | [#5 — Chrome v150 adaptive memory](https://github.com/Swir/xADKiller/pull/5) |
| Verified development progress | **23/26 = 88.5%** |
| Latest validated snapshot before main sync | `474f78837271b5916354ab42cce89710206b50f4` |
| Exact-head CI after main sync | **PENDING** |
| Release readiness | **BLOCKED** — refreshed normal-browsing/manual beta validation + merge/store gates still required |

### Android — v1.6.0 development

<img width="100%" src="assets/readme/android/progress-card.svg" alt="xADKiller Android v1.6.0 development progress" />

| Item | Status |
|---|---|
| Latest public Android release | **v1.5.1 — Adaptive AI Hotfix** |
| Development branch | [`android-v160-mega`](https://github.com/Swir/xADKiller/tree/android-v160-mega) |
| Open PR | [#4 — Android v160 mega](https://github.com/Swir/xADKiller/pull/4) |
| Verified development progress | **9/12 = 75.0%** |
| Latest validated snapshot before main sync | `cface98c1b65a52581728c5b4812d91ea08f3c43` |
| Exact-head CI after main sync | **PENDING** |
| Release readiness | **BLOCKED** — physical-device lifecycle, Wi-Fi/mobile handover and long stability/real-app soak still required |

> Development progress measures verified roadmap completion. It is **not** the same thing as blocking effectiveness and it does not authorize a Release.

## ⚡ What xADKiller does

### Chrome

- Manifest V3 Declarative Net Request blocking with STANDARD / ULTRA / TITAN protection layers.
- Adaptive Memory for high-confidence ad/tracker hosts with bounded local storage and cleanup.
- Breakage Guard and recovery controls instead of blindly disabling protection.
- Live Shield, Live Matrix and TITAN protection feeds with schema validation, cache/fallback and anti-replay/downgrade checks.
- PL / EN maintained UI and a no-COMPAT active development line.
- No remote JavaScript/Wasm execution from protection feeds.

### Android

- Rootless, device-wide DNS blocking through Android `VpnService`.
- DNS traffic is handled locally; xADKiller does **not** operate a remote VPN relay.
- Local block/allow rules, known-good blocklist cache and safe recovery.
- VPN liveness heartbeat, resolver failover/cooldown and Private DNS diagnostics.
- v1.6 health dashboard for VPN, DNS, blocklists, Smart Engine and update state.
- Local diagnostics; no xADKiller cloud log upload is required.

## 🧪 Verified test snapshots

These numbers describe fixed repository fixtures, not every site/app on the Internet.

| Scope | Current verified fixture |
|---|---|
| Chrome STANDARD | **49/49 blocked** |
| Chrome ULTRA | **49/49 blocked** |
| Chrome benign controls | **0/16 false positives** |
| Android DNS corpus | **127/127 blocked** |
| Android benign controls | **0/20 false positives** |

The Android v1.6 branch also carries the large-list/ANR qualification gate for **750,000 domains** under a constrained heap. Physical-device evidence remains a separate release requirement.

## 🔐 Feed security model

The production protection paths stay **data-only**. Live Shield, Live Matrix and TITAN may provide verified domains/rules/signatures, but executable application logic stays inside the shipped extension/app.

- production feed baseline remains **schema v1**;
- development schema-v2 work is isolated from the store baseline;
- malformed, stale or failed feeds must not replace a known-good cache;
- cache/fallback behavior is tested;
- no remote executable code is part of the feed model.

## 🚀 Quick start

### Chrome development build

```bash
git clone https://github.com/Swir/xADKiller.git
cd xADKiller
git switch chrome-v150-adaptive-memory
cd browser-extension
npm install --no-audit --no-fund
npm run build
```

Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select:

```text
browser-extension/dist/chrome
```

### Android development build

```bash
git clone https://github.com/Swir/xADKiller.git
cd xADKiller
git switch android-v160-mega
gradle --no-daemon lintDebug
gradle --no-daemon testDebugUnitTest
gradle --no-daemon assembleDebug
```

Use the public Android **Releases** page when you want the released APK rather than a development build.

## 🗺 Roadmaps

- **Chrome v1.5:** [ROADMAP_CHROME.md](https://github.com/Swir/xADKiller/blob/chrome-v150-adaptive-memory/browser-extension/ROADMAP_CHROME.md)
- **Android v1.6:** [ANDROID_V160_ROADMAP.md](https://github.com/Swir/xADKiller/blob/android-v160-mega/ANDROID_V160_ROADMAP.md)

The progress cards above mirror the verified development-branch roadmap states. Authoritative roadmap/checklist updates remain on their owning development branches.

## 📦 Releases

- Chrome stable: [`chrome-v1.4.0`](https://github.com/Swir/xADKiller/releases/tag/chrome-v1.4.0)
- Android stable: [`v1.5.1`](https://github.com/Swir/xADKiller/releases/tag/v1.5.1)

A green CI run alone does not justify merging development code or publishing a Release.

## 🔎 Search Keywords

`xADKiller` • `Chrome ad blocker` • `Manifest V3 ad blocker` • `Android ad blocker` • `Android DNS blocker` • `local VPN ad blocker` • `tracker blocker` • `privacy Chrome extension` • `no root ad blocker` • `declarative net request` • `MV3 content blocker` • `DNS filtering Android` • `Private DNS diagnostics` • `data-only filter feeds` • `Live Shield` • `TITAN ad blocker` • `SWIR`

<div align="center">

### `BLOCK • VERIFY • HARDEN • EVOLVE`

⭐ **If xADKiller is useful, consider leaving a star.**

[**SWIR profile**](https://github.com/Swir) · [**Releases**](https://github.com/Swir/xADKiller/releases) · [**Issues**](https://github.com/Swir/xADKiller/issues)

</div>
