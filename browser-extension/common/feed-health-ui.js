(() => {
  if (globalThis.__xadFeedHealthUiV1) return;
  globalThis.__xadFeedHealthUiV1 = true;

  const badge = document.getElementById("feedHealthBadge");
  const info = document.getElementById("feedHealthInfo");
  if (!badge || !info) return;

  const TEXT = {
    en:{
      waiting:"Waiting for verified feed checks…",
      verified:"VERIFIED",
      degraded:"DEGRADED",
      verifiedInfo:"Live Shield, Live Matrix and TITAN feeds passed local integrity checks",
      cached:"Cached protection remains active",
      never:"not checked yet",
      min:"min ago",
      hour:"h ago"
    },
    pl:{
      waiting:"Oczekiwanie na zweryfikowane kontrole feedów…",
      verified:"ZWERYF.",
      degraded:"OSTRZEŻ.",
      verifiedInfo:"Feedy Live Shield, Live Matrix i TITAN przeszły lokalną kontrolę integralności",
      cached:"Ochrona z ostatniego poprawnego cache pozostaje aktywna",
      never:"jeszcze nie sprawdzono",
      min:"min temu",
      hour:"godz. temu"
    }
  };

  let language = "en";

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    });
  }
  function storageGet(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, (value) => resolve(value || defaults)));
  }
  function copy() { return TEXT[language] || TEXT.en; }
  function age(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return copy().never;
    const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (minutes < 60) return `${minutes} ${copy().min}`;
    return `${Math.round(minutes / 60)} ${copy().hour}`;
  }
  function shortKind(kind) {
    if (kind === "live-shield") return "Live";
    if (kind === "live-matrix") return "Matrix";
    if (kind === "titan") return "TITAN";
    return kind;
  }

  function render(result) {
    const feeds = result?.ok && result.health?.feeds && typeof result.health.feeds === "object"
      ? result.health.feeds : {};
    const kinds = ["live-shield", "live-matrix", "titan"];
    const known = kinds.map((kind) => [kind, feeds[kind]]).filter(([, state]) => state && state.lastCheckedAt);

    if (!known.length) {
      badge.textContent = "…";
      badge.className = "pauseBadge waiting";
      info.textContent = copy().waiting;
      return;
    }

    const failed = known.filter(([, state]) => Number(state.consecutiveFailures || 0) > 0);
    if (failed.length) {
      badge.textContent = copy().degraded;
      badge.className = "pauseBadge paused";
      const details = failed.map(([kind, state]) => `${shortKind(kind)}: ${String(state.lastError || "error").slice(0, 40)}`).join(" • ");
      info.textContent = `${copy().cached} • ${details}`;
      return;
    }

    badge.textContent = copy().verified;
    badge.className = "pauseBadge off";
    const latest = Math.max(...known.map(([, state]) => Number(state.lastSuccessAt || 0)));
    const versions = known.map(([kind, state]) => `${shortKind(kind)} ${state.lastVersion || "—"}`).join(" • ");
    info.textContent = `${copy().verifiedInfo} • ${versions} • ${age(latest)}`;
  }

  async function refresh() {
    const result = await send({ type:"getFeedGuardHealth" });
    render(result);
  }

  async function init() {
    const stored = await storageGet({ uiLanguage:"" });
    const chromeLanguage = String(chrome.i18n.getUILanguage?.() || "").toLowerCase();
    language = stored.uiLanguage === "pl" || (!stored.uiLanguage && (chromeLanguage === "pl" || chromeLanguage.startsWith("pl-"))) ? "pl" : "en";
    await refresh();
    setInterval(refresh, 30000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.uiLanguage) return;
    language = changes.uiLanguage.newValue === "pl" ? "pl" : "en";
    refresh();
  });

  init();
})();
