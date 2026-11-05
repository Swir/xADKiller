# Protection data sources

The rule additions in the 2026-11-05 refresh are adapted from EasyList,
Copyright EasyList authors. We use its GPL version 3 or later licensing option.
The license text is in `COPYING-GPL-3.0.txt`. Source URLs, retrieval timestamps,
full-source SHA-256 hashes and matching line numbers are recorded in
`feed-review-2026-11-05.json`.

The modifications convert three unconditional domain rules and two script rules
to xADKiller's JSON data format, preserving the third-party restriction of the
prebid-wrapper rule. TITAN additionally uses a bounded third-party regex for
the two script names. No upstream JavaScript or executable code is delivered.

EasyPrivacy, AdGuard Base/Tracking Protection and HaGeZi Ultimate were consulted
to cross-check the existing domain selection and additions. Their original
license notices and source locations are retained in the review metadata.
HaGeZi's aggressive list was not imported wholesale. AdGuard includes EasyList,
so their agreement is not counted as two independent confirmations.

This notice concerns protection data additions, not the licensing of unrelated
application code. Upstream licensing information:

- EasyList/EasyPrivacy: https://easylist.to/pages/licence.html
- AdGuard: https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE
- HaGeZi: https://github.com/hagezi/dns-blocklists/blob/main/LICENSE
