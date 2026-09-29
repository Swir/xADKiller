(() => {
  const ids = {
    standard:"ruleBudgetStandard",
    ultra:"ruleBudgetUltra",
    boost:"ruleBudgetBoost",
    runtime:"ruleBudgetRuntime"
  };

  function number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function format(value) {
    const lang = document.documentElement.lang === "pl" ? "pl-PL" : "en-US";
    return number(value).toLocaleString(lang);
  }

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response || null);
      });
    });
  }

  function set(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = format(value);
  }

  async function refresh() {
    const [state, shield, matrix, titan] = await Promise.all([
      send({ type:"getState", host:"" }),
      send({ type:"getDynamicShieldStats" }),
      send({ type:"getLiveMatrixStats" }),
      send({ type:"getTitanStats" })
    ]);
    const build = state?.build || {};
    set(ids.standard, build.standardRules);
    set(ids.ultra, build.ultraRules);
    set(ids.boost, build.titanBoostRules);

    // Runtime budget intentionally reports live rule buckets rather than a
    // browser-limit percentage. This avoids presenting a misleading quota when
    // Chrome changes limits or when rule buckets overlap by implementation.
    const runtime = number(shield?.total)
      + number(matrix?.signatures)
      + number(titan?.session)
      + number(titan?.regex)
      + number(titan?.learned);
    set(ids.runtime, runtime);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.mode || changes.enabled || changes.uiLanguage)) refresh().catch(() => {});
  });

  refresh().catch(() => {});
})();
