# xADKiller Chrome Web Store Listing — v1.4.0 TITAN

## Product name
xADKiller — TITAN Ad & Tracker Blocker

## Short description
Blocks ads and trackers with multi-layer TITAN protection, Smart DOM filtering, Auto-Skip and live rule updates.

## Detailed description
xADKiller is a privacy-focused ad and tracker blocker for Chrome built around a multi-layer protection engine.

It combines declarative network blocking with local cosmetic filtering and browser-side protection for dynamic advertising elements. STANDARD mode focuses on balanced everyday protection, while ULTRA enables the strongest available xADKiller layers.

Key features:

- STANDARD and ULTRA protection modes
- large static, dynamic and session blocking rule sets
- Adaptive Static Boost that uses additional Chrome rule capacity when available
- Smart DOM filtering for dynamically inserted advertising UI
- open and closed Shadow DOM protection
- Auto-Skip for clearly identified ad skip controls
- Preflight Guard for strong advertising request signatures
- Worker, popup and injected-markup protections in ULTRA mode
- per-site allowlist
- custom blocked domains
- local adaptive network learning
- xADKiller Live Shield / Live Matrix rule-data updates
- built-in English / Polish interface switch with locally saved preference
- Polish is selected automatically when Chrome UI is Polish; other browser languages fall back to English

Privacy first:

xADKiller does not sell user data, does not use advertising telemetry and does not download remote executable code. Settings and adaptive protection data are stored locally in the browser profile. Public GitHub feeds provide rule/signature data only.

The extension requires access to websites because blocking advertising and tracking resources must work across the pages the user visits.

Benchmark results depend on the test website, Chrome version, enabled mode and other installed extensions. A local pre-release test of v1.4.0 TITAN reached 76%; this is not a guarantee of the same score on every device or website.

Open-source project and support:
https://github.com/Swir/xADKiller

Privacy policy:
https://github.com/Swir/xADKiller/blob/main/browser-extension/PRIVACY.md

## Category
Privacy & Security

## Language
English (default) and Polish. Users can switch language directly inside the xADKiller popup and the selected language is saved locally. No browser restart is required.

For the initial Chrome Web Store submission, use a single English Store Listing. Separate localized Store Listing entries are not required for the built-in Polish interface.

## Homepage
https://github.com/Swir/xADKiller

## Support URL
https://github.com/Swir/xADKiller/issues

## Privacy policy URL
https://github.com/Swir/xADKiller/blob/main/browser-extension/PRIVACY.md

## Single purpose statement
xADKiller's single purpose is to protect web browsing by blocking advertising and tracking network requests and removing related advertising UI locally in Chrome.

## Permission justifications

### storage
Required to save protection mode, English/Polish UI language, Smart DOM/Auto-Skip settings, allowlisted sites, custom block entries, cached rule-data versions and local adaptive-protection state.

### alarms
Required to schedule periodic refreshes of xADKiller Live Shield / Live Matrix protection data.

### declarativeNetRequest
Required for the core ad/tracker-blocking function. It lets xADKiller block matching network requests using Chrome's Manifest V3 declarative rules.

### activeTab
Required for user-initiated popup actions and local diagnostics for the currently active tab, including site allowlisting and current-tab blocking statistics.

### <all_urls> host access
Required because ads and tracking resources can appear on arbitrary HTTP/HTTPS websites. xADKiller needs site access to apply cosmetic/Smart DOM protection and related local blocking logic across sites.

## Data-use declarations guidance

Declare only data types that the final Chrome Web Store questionnaire requires based on its wording. xADKiller does not sell data, does not use data for personalized advertising, and does not transfer browsing history/page content to an xADKiller analytics backend. Website content and URLs may be processed locally to provide the blocker’s core functionality.

## Required graphics checklist

- 128x128 extension icon: already packaged in the extension
- at least one 1280x800 screenshot (up to five)
- 440x280 small promo tile
- 1400x560 marquee promo image: optional for normal publication, useful for promotion/featuring

Store screenshots must show the real, current extension experience rather than a fabricated UI.
