(() => {
  const COMPAT_RULESET = "compat";
  let applying = null;

  function local(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  async function enabledRulesets() {
    try { return await chrome.declarativeNetRequest.getEnabledRulesets(); }
    catch (_) { return []; }
  }
  async function applyCompat() {
    if (applying) return applying;
    applying = (async () => {
      const prefs = await local({ enabled:true, mode:"standard", compatEnabled:false });
      const enabled = await enabledRulesets();
      const active = enabled.includes(COMPAT_RULESET);
      const wanted = prefs.enabled !== false && prefs.mode !== "ultra" && prefs.compatEnabled === true;
      if (active !== wanted) {
        try {
          await chrome.declarativeNetRequest.updateEnabledRulesets(wanted
            ? { enableRulesetIds:[COMPAT_RULESET], disableRulesetIds:[] }
            : { enableRulesetIds:[], disableRulesetIds:[COMPAT_RULESET] });
        } catch (error) {
          console.warn("xADKiller COMPAT transition failed", error);
        }
      }
      const finalEnabled = await enabledRulesets();
      const finalActive = finalEnabled.includes(COMPAT_RULESET);
      await new Promise((resolve) => chrome.storage.local.set({
        xadCompatActive: finalActive,
        xadCompatRequested: prefs.compatEnabled === true,
        xadCompatMode: prefs.mode === "ultra" ? "ultra" : "standard",
        xadCompatCheckedAt: Date.now()
      }, resolve));
      return { ok:true, active:finalActive, wanted, requested:prefs.compatEnabled === true };
    })().finally(() => { applying = null; });
    return applying;
  }

  chrome.runtime.onInstalled.addListener(() => applyCompat().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => applyCompat().catch(() => {}));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.mode || changes.compatEnabled)) applyCompat().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "getCompatStats") {
      Promise.all([local({enabled:true,mode:"standard",compatEnabled:false}), enabledRulesets()]).then(([prefs, enabled]) => {
        sendResponse({
          ok:true,
          active:enabled.includes(COMPAT_RULESET),
          requested:prefs.compatEnabled === true,
          mode:prefs.mode === "ultra" ? "ultra" : "standard"
        });
      }).catch((error) => sendResponse({ok:false,error:String(error?.message || error)}));
      return true;
    }
    if (msg?.type === "setCompatEnabled") {
      const compatEnabled = msg.compatEnabled === true;
      chrome.storage.local.set({ compatEnabled }, () => {
        applyCompat().then((result) => sendResponse({ ...result, compatEnabled }))
          .catch((error) => sendResponse({ok:false,error:String(error?.message || error)}));
      });
      return true;
    }
    if (msg?.type === "refreshCompat") {
      applyCompat().then(sendResponse).catch((error) => sendResponse({ok:false,error:String(error?.message || error)}));
      return true;
    }
    return false;
  });

  applyCompat().catch(() => {});
})();
