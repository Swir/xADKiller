(() => {
  if (globalThis.__xadStandardCoreBoostV1) return;
  globalThis.__xadStandardCoreBoostV1 = true;

  const RULE_MIN = 165000;
  const RULE_MAX = 165009;
  const CORE_RULES = [
    {
      id: RULE_MIN,
      priority: 88,
      action: { type:"block" },
      condition: { urlFilter:"/ima3/", resourceTypes:["script","xmlhttprequest"] }
    },
    {
      id: RULE_MIN + 1,
      priority: 88,
      action: { type:"block" },
      condition: { urlFilter:"/commercial/preroll", resourceTypes:["xmlhttprequest","sub_frame","media"] }
    }
  ];

  function getLocal(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }
  function getDynamicRules() {
    return new Promise((resolve) => chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules || [])));
  }
  function updateDynamicRules(payload) {
    return new Promise((resolve, reject) => chrome.declarativeNetRequest.updateDynamicRules(payload, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) reject(new Error(error)); else resolve();
    }));
  }

  async function apply() {
    const [prefs, current] = await Promise.all([
      getLocal({ enabled:true }),
      getDynamicRules()
    ]);
    const removeRuleIds = current.filter((r) => r.id >= RULE_MIN && r.id <= RULE_MAX).map((r) => r.id);
    const addRules = prefs.enabled === false ? [] : CORE_RULES;
    await updateDynamicRules({ removeRuleIds, addRules });
    return { ok:true, count:addRules.length };
  }

  chrome.runtime.onInstalled.addListener(() => apply().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => apply().catch(() => {}));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) apply().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "getStandardCoreBoostStats") {
      getDynamicRules().then((rules) => sendResponse({
        ok:true,
        count:rules.filter((r) => r.id >= RULE_MIN && r.id <= RULE_MAX).length
      })).catch((error) => sendResponse({ok:false,error:String(error?.message||error)}));
      return true;
    }
    return false;
  });

  apply().catch(() => {});
})();
