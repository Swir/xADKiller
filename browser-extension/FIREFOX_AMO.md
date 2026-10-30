# Manual Firefox Add-ons listing

Name: **xADKiller — TITAN Ad & Tracker Blocker**

Summary (English):

Blocks ads and trackers with local network rules, cosmetic filtering, site controls and Polish/English UI.

Description (English):

xADKiller for Firefox blocks advertising and tracking requests and hides advertising elements while keeping protection settings under your control.

- STANDARD and ULTRA protection modes.
- TITAN network rules and local Adaptive Memory.
- Cosmetic and Shadow DOM filtering.
- Auto-Skip for recognized ad controls.
- Per-site exceptions, temporary pause and recovery controls.
- Custom blocked domains and element selection.
- Polish and English interface.

Settings and learned protection data stay in the browser profile. Public GitHub endpoints provide protection data only; executable extension code is included in the installed package. Update requests do not include browsing history or page content. Like any network request, GitHub can see network connection metadata such as the source IP address.

No blocker removes every ad. If a site stops working, use recovery or temporarily pause protection on that site.

Summary (Polish):

Blokuje reklamy i elementy śledzące. Oferuje tryby STANDARD/ULTRA, wyjątki dla stron i interfejs po polsku oraz angielsku.

Description (Polish):

xADKiller dla Firefoksa blokuje żądania reklamowe i śledzące oraz ukrywa elementy reklamowe na stronach. Oferuje tryby STANDARD i ULTRA, ochronę TITAN, lokalną pamięć adaptacyjną, filtrowanie Shadow DOM, Auto-Skip, własne reguły oraz wyjątki i czasowe wstrzymanie ochrony dla wybranej strony.

Ustawienia i dane uczenia pozostają w profilu przeglądarki. Wtyczka pobiera z publicznego repozytorium GitHub wyłącznie dane ochrony, bez zdalnego kodu wykonywalnego. Nie wysyła historii przeglądania ani treści stron. Serwer GitHuba widzi standardowe dane połączenia, takie jak adres IP.

Żaden bloker nie usuwa każdej reklamy. Gdy strona działa nieprawidłowo, można użyć funkcji przywracania działania albo czasowo wstrzymać na niej ochronę.

Homepage: https://github.com/Swir/xADKiller

Support: https://github.com/Swir/xADKiller/issues

Privacy policy: https://github.com/Swir/xADKiller/blob/main/browser-extension/PRIVACY.md

Suggested category: Privacy & Security.

Reviewer notes: Firefox 142+ Manifest V3 extension. No telemetry backend and no remote executable code. Protection feeds are parsed and validated by packaged JavaScript. The Firefox build uses the frozen filter data snapshot supplied in source, with a deterministic local build. Network/domain matching is grouped to fit Firefox DNR quotas. See `FIREFOX.md` for exact build and test commands. Mozilla signing/publication is handled manually.
