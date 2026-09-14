# xADKiller Browser Extension — Privacy Policy

Last updated: 2026-09-14

xADKiller is a browser extension designed to block advertising and tracking requests and to hide advertising user-interface elements locally in the browser.

## Data handling

xADKiller does not sell personal data, does not use advertising analytics, does not create user accounts, and does not transmit browsing history or page content to an xADKiller analytics or profiling service.

The extension processes website URLs, request destinations and page DOM/text signals locally when needed to provide ad/tracker blocking, cosmetic filtering, Smart DOM detection, Auto-Skip, per-site allowlisting and local adaptive protection. This processing is used only to provide the extension's user-facing functionality.

## Local storage

The extension may store the following information locally in the Chrome profile:

- whether protection is enabled;
- STANDARD or ULTRA mode;
- Auto-Skip and Smart DOM preferences;
- user-created allowlist and custom block entries;
- locally learned protection features and counters;
- cached versions of xADKiller rule/signature data.

This locally stored configuration is not sold or used for advertising profiling.

## Network access and rule updates

xADKiller periodically downloads rule and signature **data** from the public Swir/xADKiller GitHub repository. These feeds contain blocking domains, URL signatures, cosmetic selectors and related protection metadata. They are data only; xADKiller does not download or execute remote JavaScript or other remote executable code.

Requests to GitHub are subject to GitHub's own network and privacy practices. xADKiller does not attach a user account identifier or browsing history to its rule-update requests.

## Website access

xADKiller requests access to HTTP and HTTPS websites because an ad blocker must be able to apply network and cosmetic protection across sites. Access is used to block advertising/tracking resources, remove or hide ad UI, operate Smart DOM/Auto-Skip features, and honor per-site user settings.

The extension does not use this access to collect passwords, payment information, health information, private messages or other sensitive form contents for sale, advertising, credit decisions or unrelated profiling.

## Chrome permissions

- `declarativeNetRequest`: applies local network blocking rules.
- `storage`: stores extension settings and locally learned protection data.
- `alarms`: schedules periodic refresh of protection data.
- `activeTab`: lets the popup work with the tab the user is actively using, including site controls and local diagnostics.
- `<all_urls>` host access: required to apply blocking and cosmetic protection on websites.

## Remote code

xADKiller does not use remotely hosted executable code. Extension logic ships inside the installed extension package. Remote GitHub resources used by the extension are treated as data and are parsed by local packaged code.

## Sharing and sale

xADKiller does not sell user data and does not share browsing data with advertisers or data brokers.

## Retention and removal

Local extension data remains in the user's Chrome profile until it is changed, cleared, or the extension is removed. Removing xADKiller through Chrome removes extension-local storage according to Chrome's extension storage behavior.

## Changes

This policy may be updated when xADKiller functionality changes. Material changes will be reflected in this public document.

## Contact and support

Project and support: https://github.com/Swir/xADKiller

Issues: https://github.com/Swir/xADKiller/issues
