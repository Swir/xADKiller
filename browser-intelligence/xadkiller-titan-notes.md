# xADKiller TITAN Shield

Data and design notes for the browser-extension TITAN protection layer.

- Static DNR: packaged, deterministic rules.
- Dynamic DNR: safe block/allow rules, Live Matrix and domain intelligence.
- Session DNR: aggressive first-party ad/tracker path signatures, rebuilt per browser session.
- MAIN-world Preflight Guard: blocks strong ad/tracker URLs before page APIs create requests.
- Closed Shadow Shield: scans open and closed shadow roots created after document_start.
- Adaptive Network Learner: local-only learning; never uploads browsing history.

Remote GitHub feeds are data only. No remote JavaScript is executed by the extension.
