(() => {
  "use strict";

  const STORAGE_KEY = "xadBetaReviewWitnessV1";
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
    for (const node of document.querySelectorAll("[data-en][data-pl]")) {
      node.textContent = pl ? node.dataset.pl : node.dataset.en;
    }
  }

  function normalizeHost(value) {
    let host = String(value || "").trim().toLowerCase();
    while (host.endsWith(".")) host = host.slice(0, -1);
    if (!host || host.length > 253 || /[\s\/@?#]/.test(host) || host.includes("://")) return "";
    const labels = host.split(".");
    if (labels.length < 2) return "";
    for (const label of labels) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return "";
    }
    return host;
  }

  async function hashHost(host) {
    const bytes = new TextEncoder().encode(host);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  function storageGet() {
    return new Promise((resolve) => chrome.storage.local.get({ [STORAGE_KEY]:[] }, (value) => {
      const raw = Array.isArray(value?.[STORAGE_KEY]) ? value[STORAGE_KEY] : [];
      resolve(raw.slice(-MAX_RECORDS).filter((item) => item && typeof item === "object"));
    }));
  }
  function storageSet(items) {
    const safe = Array.isArray(items) ? items.slice(-MAX_RECORDS) : [];
    return new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]:safe }, resolve));
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
    const coverageReady =
      items.length >= REQUIREMENTS.minObservations &&
      uniqueHosts >= REQUIREMENTS.minUniqueHosts &&
      pageTypes >= REQUIREMENTS.minPageTypes &&
      standard >= REQUIREMENTS.minPerMode &&
      ultra >= REQUIREMENTS.minPerMode &&
      contentFailures === 0 &&
      unrecoveredBreakage === 0;
    return { observations:items.length, unique_hosts:uniqueHosts, page_types:pageTypes, standard, ultra,
      content_failures:contentFailures, blocking_observed:blockingObserved, breakage,
      unrecovered_breakage:unrecoveredBreakage, coverage_ready:coverageReady };
  }

  async function render() {
    const items = await storageGet();
    const s = summarize(items);
    const cls = s.coverage_ready ? "ready" : "blocked";
    $("summary").innerHTML =
      `<div class="${cls}"><strong>${s.coverage_ready ? t("COVERAGE READY", "POKRYCIE GOTOWE") : t("COVERAGE INCOMPLETE", "POKRYCIE NIEPEŁNE")}</strong></div>` +
      `<div>${t("Observations", "Obserwacje")}: ${s.observations}/${REQUIREMENTS.minObservations} · ` +
      `${t("unique hosts", "unikalne hosty")}: ${s.unique_hosts}/${REQUIREMENTS.minUniqueHosts} · ` +
      `${t("page types", "typy stron")}: ${s.page_types}/${REQUIREMENTS.minPageTypes}</div>` +
      `<div>STANDARD: ${s.standard}/${REQUIREMENTS.minPerMode} · ULTRA: ${s.ultra}/${REQUIREMENTS.minPerMode} · ` +
      `${t("content failures", "błędy treści")}: ${s.content_failures} · ${t("unrecovered breakage", "nieodzyskane awarie")}: ${s.unrecovered_breakage}</div>`;
  }

  async function addObservation() {
    const rawHost = $("host").value;
    const host = normalizeHost(rawHost);
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

    const hostHash = await hashHost(host);
    const items = await storageGet();
    items.push({
      host_hash: hostHash,
      mode,
      page_type: pageType,
      expected_content_ok: $("contentOk").checked,
      blocking_observed: $("blockingObserved").checked,
      breakage,
      recovery,
      recorded_at: new Date().toISOString()
    });
    await storageSet(items);
    $("host").value = "";
    $("status").className = "";
    $("status").textContent = t("Observation saved locally; raw hostname was discarded.", "Obserwacja zapisana lokalnie; surowy host został odrzucony.");
    await render();
  }

  async function exportWitness() {
    const items = await storageGet();
    if (!items.length) {
      $("status").textContent = t("Nothing to export yet.", "Nie ma jeszcze danych do eksportu.");
      return;
    }
    const summary = summarize(items);
    const witness = {
      schema: 1,
      generated_at: new Date().toISOString(),
      scope: "xADKiller Chrome v1.5 normal-browsing local beta review",
      privacy: {
        hostnames: "sha256-prefix-16",
        urls: "omitted",
        paths_queries_fragments: "omitted",
        page_titles: "omitted",
        telemetry: false
      },
      candidate: {
        extension_version: String(chrome.runtime.getManifest()?.version || ""),
        source_commit: "unbound",
        package_sha256: "unbound",
        bound: false
      },
      coverage_requirements: {
        min_observations: REQUIREMENTS.minObservations,
        min_unique_hosts: REQUIREMENTS.minUniqueHosts,
        min_page_types: REQUIREMENTS.minPageTypes,
        min_per_mode: REQUIREMENTS.minPerMode,
        require_zero_content_failures: true,
        require_zero_unrecovered_breakage: true
      },
      coverage_review_ready: summary.coverage_ready,
      release_gate_closed: false,
      summary,
      observations: items
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
  $("export").addEventListener("click", () => exportWitness().catch((error) => { $("status").textContent = String(error?.message || error); }));
  $("reset").addEventListener("click", () => resetEvidence().catch((error) => { $("status").textContent = String(error?.message || error); }));
  render().catch(() => {});
})();
