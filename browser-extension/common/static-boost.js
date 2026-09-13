(() => {
  const IDS = ["titan_boost_1", "titan_boost_2", "titan_boost_3"];
  let metaPromise = null;
  let applying = null;

  function local(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  async function meta() {
    if (!metaPromise) {
      metaPromise = fetch(chrome.runtime.getURL("titan-boost-meta.json"))
        .then((r) => { if (!r.ok) throw new Error(`boost_meta_http_${r.status}`); return r.json(); })
        .then((m) => ({ counts:Array.isArray(m?.counts) ? m.counts.map((x) => Math.max(0, Number(x)||0)).slice(0, IDS.length) : [], total:Number(m?.total||0) }))
        .catch((error) => { console.warn("xADKiller Static Boost metadata unavailable", error); return { counts:[], total:0 }; });
    }
    return metaPromise;
  }
  async function enabledRulesets() {
    try { return await chrome.declarativeNetRequest.getEnabledRulesets(); }
    catch (_) { return []; }
  }
  async function availableStatic() {
    try { return Math.max(0, Number(await chrome.declarativeNetRequest.getAvailableStaticRuleCount()) || 0); }
    catch (_) { return 0; }
  }
  function updateRulesets(enableRulesetIds, disableRulesetIds) {
    return chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  }

  async function apply() {
    if (applying) return applying;
    applying = (async () => {
      const [prefs, m, enabled, available] = await Promise.all([
        local({ enabled:true, mode:"standard" }),
        meta(),
        enabledRulesets(),
        availableStatic()
      ]);
      const counts = IDS.map((_, i) => Number(m.counts[i] || 0));
      const currentlyEnabled = IDS.filter((id) => enabled.includes(id));
      const currentBoostCost = currentlyEnabled.reduce((sum, id) => sum + counts[IDS.indexOf(id)], 0);
      let budget = available + currentBoostCost;
      const target = [];
      if (prefs.enabled !== false) {
        const maxSets = prefs.mode === "ultra" ? IDS.length : 1;
        for (let i = 0; i < maxSets; i++) {
          const cost = counts[i];
          if (!cost || cost > budget) break;
          target.push(IDS[i]);
          budget -= cost;
        }
      }
      const enableRulesetIds = target.filter((id) => !currentlyEnabled.includes(id));
      const disableRulesetIds = currentlyEnabled.filter((id) => !target.includes(id));
      if (enableRulesetIds.length || disableRulesetIds.length) {
        try {
          await updateRulesets(enableRulesetIds, disableRulesetIds);
        } catch (error) {
          console.warn("xADKiller Static Boost activation failed, falling back safely", error);
          // Keep guaranteed core rulesets untouched. If a bulk activation races
          // another extension for the global quota, retry one boost at a time.
          const now = await enabledRulesets();
          for (const id of IDS) {
            if (now.includes(id) && !target.includes(id)) {
              try { await updateRulesets([], [id]); } catch (_) {}
            }
          }
          for (const id of target) {
            const check = await enabledRulesets();
            if (check.includes(id)) continue;
            const free = await availableStatic();
            const cost = counts[IDS.indexOf(id)];
            if (cost <= free) {
              try { await updateRulesets([id], []); } catch (_) { break; }
            }
          }
        }
      }
      const finalEnabled = await enabledRulesets();
      const active = IDS.filter((id) => finalEnabled.includes(id));
      const activeRules = active.reduce((sum, id) => sum + counts[IDS.indexOf(id)], 0);
      const freeAfter = await availableStatic();
      await new Promise((resolve) => chrome.storage.local.set({
        xadStaticBoostActive:active,
        xadStaticBoostRules:activeRules,
        xadStaticBoostAvailable:freeAfter,
        xadStaticBoostCheckedAt:Date.now()
      }, resolve));
      return { ok:true, active, activeRules, available:freeAfter, packaged:m.total };
    })().finally(() => { applying = null; });
    return applying;
  }

  async function stats() {
    const [m, enabled, free] = await Promise.all([meta(), enabledRulesets(), availableStatic()]);
    const counts = IDS.map((_, i) => Number(m.counts[i] || 0));
    const active = IDS.filter((id) => enabled.includes(id));
    return {
      ok:true,
      active,
      activeRules:active.reduce((sum, id) => sum + counts[IDS.indexOf(id)], 0),
      packaged:m.total,
      available:free
    };
  }

  chrome.runtime.onInstalled.addListener(() => apply().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => apply().catch(() => {}));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode)) apply().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "getStaticBoostStats") {
      stats().then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    if (msg?.type === "refreshStaticBoost") {
      apply().then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    return false;
  });

  apply().catch(() => {});
})();
