(() => {
  "use strict";

  const STORAGE_KEY = "xadBetaReviewWitnessV1";
  const FEED_V2_STATE_KEY = "xadFeedV2BetaChannelV1";
  const FEED_V2_RUNTIME_KEY = "xadFeedV2BetaRuntimeV1";
  const FEED_V2_PINNED_REF = "824982ab9654539ff55a70a27a4993b90b8d2e2b";
  const FEED_V2_MAX_SESSION_MS = 6 * 60 * 60 * 1000;
  const MAX_RECORDS = 200;
  const REQUIREMENTS = Object.freeze({
    minObservations: 8,
    minUniqueHosts: 6,
    minPageTypes: 4,
    minPerMode: 2
  });
  const PAGE_TYPES = new Set(["news","video","shop","login","checkout","search","social","other"]);
  const RECOVERY = new Set(["none","heuristic_pause","site_pause","allowlist"]);
  const MODES = new Set(["standard","ultra"]);

  const $ = (id) => document.getElementById(id);
  const pl = String(chrome.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase().startsWith("pl");
  const t = (en, plText) => pl ? plText : en;

  function applyLanguage() {
    document.documentElement.lang = pl ? "pl" : "en";
    for (const node of document.querySelectorAll("[data-en][data-pl]")) node.textContent = pl ? node.dataset.pl : node.dataset.en;
  }

  function normalizeHost(value) {
    let host = String(value || "").trim().toLowerCase();
    while (host.endsWith(".")) host = host.slice(0, -1);
    if (!host || host.length > 253 || /[\s\/@?#]/.test(host) || host.includes("://")) return "";
    const labels = host.split(".");
    if (labels.length < 2) return "";
    for (const label of labels) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return "";
    return host;
  }

  async function hashHost(host) {
    const bytes = new TextEncoder().encode(host);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  function storageGet(defaults = { [STORAGE_KEY]:[] }) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function storageSetValues(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
  async function reviewItems() {
    const value = await storageGet({ [STORAGE_KEY]:[] });
    const raw = Array.isArray(value?.[STORAGE_KEY]) ? value[STORAGE_KEY] : [];
    return raw.slice(-MAX_RECORDS).filter((item) => item && typeof item === "object");
  }
  function storageSet(items) {
    const safe = Array.isArray(items) ? items.slice(-MAX_RECORDS) : [];
    return storageSetValues({ [STORAGE_KEY]:safe });
  }

  function summarize(items) {
    const uniqueHosts = new Set(items.map((item) => item.host_hash)).size;
    const pageTypes = new Set(items.map((item) => item.page_type)).size;
    const standard = items.filter((item) => item.mode === "standard").length;
    const ultra = items.filter((item) => item.mode === "ultra").length;
    const contentFailures = items.filter((item) => !item.expected_content_ok).length;
    const breakage = items.filter((item) => item.breakage).length;
    const unrecoveredBreakage = items.filter((item) => item.breakage && item.recovery === "none").length;
    const blockingObserved = items.filter((item) => item.blocking_observed).length;
    const coverageReady = items.length >= REQUIREMENTS.minObservations && uniqueHosts >= REQUIREMENTS.minUniqueHosts &&
      pageTypes >= REQUIREMENTS.minPageTypes && standard >= REQUIREMENTS.minPerMode && ultra >= REQUIREMENTS.minPerMode &&
      contentFailures === 0 && unrecoveredBreakage === 0;
    return { observations:items.length, unique_hosts:uniqueHosts, page_types:pageTypes, standard, ultra,
      content_failures:contentFailures, blocking_observed:blockingObserved, breakage,
      unrecovered_breakage:unrecoveredBreakage, coverage_ready:coverageReady };
  }

  function feedV2StateActive(state, now = Date.now()) {
    if (!state || typeof state !== "object") return false;
    const activatedAt = Number(state.activated_at || 0);
    const expiresAt = Number(state.expires_at || 0);
    return state.schema === 1 && state.enabled === true && state.pinned_ref === FEED_V2_PINNED_REF &&
      Number.isFinite(activatedAt) && Number.isFinite(expiresAt) && activatedAt > 0 && expiresAt > now &&
      expiresAt > activatedAt && expiresAt - activatedAt <= FEED_V2_MAX_SESSION_MS;
  }
  async function feedV2Snapshot() {
    const stored = await storageGet({ [FEED_V2_STATE_KEY]:null, [FEED_V2_RUNTIME_KEY]:null });
    const state = stored?.[FEED_V2_STATE_KEY];
    const runtime = stored?.[FEED_V2_RUNTIME_KEY];
    const active = feedV2StateActive(state);
    const feeds = runtime?.feeds && typeof runtime.feeds === "object" ? runtime.feeds : {};
    const safeFeeds = {};
    for (const kind of ["live-shield","live-matrix","titan"]) {
      const item = feeds[kind];
      if (!item || typeof item !== "object") continue;
      safeFeeds[kind] = {
        ok:item.ok === true,
        fallback:item.fallback === true,
        status:Math.max(0, Number(item.status || 0)),
        checked_at:Math.max(0, Number(item.checked_at || 0)),
        error:String(item.error || "").slice(0, 96)
      };
    }
    return { active, pinned_ref:FEED_V2_PINNED_REF, expires_at:active ? Number(state.expires_at) : 0, feeds:safeFeeds };
  }

  async function render() {
    const items = await reviewItems();
    const s = summarize(items);
    const cls = s.coverage_ready ? "ready" : "blocked";
    $("summary").innerHTML =
      `<div class="${cls}"><strong>${s.coverage_ready ? t("COVERAGE READY", "POKRYCIE GOTOWE") : t("COVERAGE INCOMPLETE", "POKRYCIE NIEPEŁNE")}</strong></div>` +
      `<div>${t("Observations", "Obserwacje")}: ${s.observations}/${REQUIREMENTS.minObservations} · ${t("unique hosts", "unikalne hosty")}: ${s.unique_hosts}/${REQUIREMENTS.minUniqueHosts} · ${t("page types", "typy stron")}: ${s.page_types}/${REQUIREMENTS.minPageTypes}</div>` +
      `<div>STANDARD: ${s.standard}/${REQUIREMENTS.minPerMode} · ULTRA: ${s.ultra}/${REQUIREMENTS.minPerMode} · ${t("content failures", "błędy treści")}: ${s.content_failures} · ${t("unrecovered breakage", "nieodzyskane awarie")}: ${s.unrecovered_breakage}</div>`;

    const v2 = await feedV2Snapshot();
    const seen = Object.keys(v2.feeds).length;
    $("feedV2Status").innerHTML = v2.active
      ? `<div class="ready"><strong>${t("PINNED V2 ACTIVE", "PRZYPIĘTE V2 AKTYWNE")}</strong></div><div>${t("Expires", "Wygasa")}: ${new Date(v2.expires_at).toLocaleString()} · ${t("feed kinds observed", "zaobserwowane typy feedów")}: ${seen}/3</div><div><code>${v2.pinned_ref.slice(0, 12)}</code></div>`
      : `<div class="blocked"><strong>${t("PRODUCTION V1 ROUTE", "PRODUKCYJNA ŚCIEŻKA V1")}</strong></div><div>${t("Pinned v2 beta is off or expired.", "Beta przypiętych v2 jest wyłączona lub wygasła.")}</div>`;
  }

  async function addObservation() {
    const host = normalizeHost($("host").value);
    if (!host) {
      $("status").textContent = t("Enter a valid public-style hostname, e.g. example.com.", "Podaj prawidłowy publiczny host, np. example.com.");
      $("status").className = "bad";
      return;
    }
    const mode = $("mode").value;
    const pageType = $("pageType").value;
    const recovery = $("recovery").value;
    const breakage = $("breakage").checked;
    if (!MODES.has(mode) || !PAGE_TYPES.has(pageType) || !RECOVERY.has(recovery)) return;
    if (!breakage && recovery !== "none") {
      $("status").textContent = t("Recovery may only be recorded when breakage is checked.", "Recovery można zapisać tylko po zaznaczeniu awarii strony.");
      $("status").className = "bad";
      return;
    }

    const items = await reviewItems();
    items.push({ host_hash:await hashHost(host), mode, page_type:pageType, expected_content_ok:$("contentOk").checked,
      blocking_observed:$("blockingObserved").checked, breakage, recovery, recorded_at:new Date().toISOString() });
    await storageSet(items);
    $("host").value = "";
    $("status").className = "";
    $("status").textContent = t("Observation saved locally; raw hostname was discarded.", "Obserwacja zapisana lokalnie; surowy host został odrzucony.");
    await render();
  }

  async function enableFeedV2() {
    const activatedAt = Date.now();
    await storageSetValues({
      [FEED_V2_STATE_KEY]:{ schema:1, enabled:true, activated_at:activatedAt, expires_at:activatedAt + FEED_V2_MAX_SESSION_MS, pinned_ref:FEED_V2_PINNED_REF },
      [FEED_V2_RUNTIME_KEY]:{ schema:1, pinned_ref:FEED_V2_PINNED_REF, updated_at:activatedAt, feeds:{} }
    });
    $("status").className = "";
    $("status").textContent = t("Pinned v2 beta enabled locally for up to 6 hours. Reload test pages to exercise all feeds.", "Beta przypiętych v2 włączona lokalnie maksymalnie na 6 godzin. Przeładuj strony testowe, aby uruchomić wszystkie feedy.");
    await render();
  }
  async function disableFeedV2() {
    await storageSetValues({ [FEED_V2_STATE_KEY]:{ schema:1, enabled:false, activated_at:0, expires_at:0, pinned_ref:FEED_V2_PINNED_REF } });
    $("status").className = "";
    $("status").textContent = t("Pinned v2 beta disabled; production v1 route restored.", "Beta przypiętych v2 wyłączona; przywrócono produkcyjną ścieżkę v1.");
    await render();
  }

  async function exportWitness() {
    const items = await reviewItems();
    if (!items.length) { $("status").textContent = t("Nothing to export yet.", "Nie ma jeszcze danych do eksportu."); return; }
    const summary = summarize(items);
    const feedV2 = await feedV2Snapshot();
    const witness = {
      schema:1,
      generated_at:new Date().toISOString(),
      scope:"xADKiller Chrome v1.5 normal-browsing local beta review",
      privacy:{ hostnames:"sha256-prefix-16", urls:"omitted", paths_queries_fragments:"omitted", page_titles:"omitted", telemetry:false },
      candidate:{ extension_version:String(chrome.runtime.getManifest()?.version || ""), source_commit:"unbound", package_sha256:"unbound", bound:false },
      feed_v2_beta:feedV2,
      coverage_requirements:{ min_observations:REQUIREMENTS.minObservations, min_unique_hosts:REQUIREMENTS.minUniqueHosts,
        min_page_types:REQUIREMENTS.minPageTypes, min_per_mode:REQUIREMENTS.minPerMode,
        require_zero_content_failures:true, require_zero_unrecovered_breakage:true },
      coverage_review_ready:summary.coverage_ready,
      release_gate_closed:false,
      summary,
      observations:items
    };
    const blob = new Blob([JSON.stringify(witness, null, 2) + "\n"], { type:"application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `xadkiller-beta-review-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    $("status").className = "";
    $("status").textContent = t("Privacy-safe witness exported. Release gate is still blocked until the tested ZIP is bound and reviewed.", "Bezpieczny witness wyeksportowany. Bramka Release nadal jest zablokowana do czasu powiązania i przeglądu testowanego ZIP.");
  }

  async function resetEvidence() {
    await storageSet([]);
    $("status").className = "";
    $("status").textContent = t("Local beta evidence cleared.", "Lokalne dowody beta wyczyszczone.");
    await render();
  }

  applyLanguage();
  $("add").addEventListener("click", () => addObservation().catch((error) => { $("status").textContent = String(error?.message || error); }));
  $("feedV2Enable").addEventListener("click", () => enableFeedV2().catch((error) => { $("status").textContent = String(error?.message || error); }));
  $("feedV2Disable").addEventListener("click", () => disableFeedV2().catch((error) => { $("status").textContent = String(error?.message || error); }));
  $("export").addEventListener("click", () => exportWitness().catch((error) => { $("status").textContent = String(error?.message || error); }));
  $("reset").addEventListener("click", () => resetEvidence().catch((error) => { $("status").textContent = String(error?.message || error); }));
  render().catch(() => {});
})();
