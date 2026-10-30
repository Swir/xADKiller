// Test-only popup driver. Never copied into a release package.
// Exposes a small fixed command set, not arbitrary code execution.
(async () => {
  const endpoint = globalThis.XAD_TEST_ENDPOINT;
  async function run({ name, args }) {
    switch (name) {
      case "send": return browser.runtime.sendMessage(args);
      case "rules": return {
        dynamic: await browser.declarativeNetRequest.getDynamicRules(),
        session: await browser.declarativeNetRequest.getSessionRules(),
        enabled: await browser.declarativeNetRequest.getEnabledRulesets()
      };
      case "benchmark": {
        const check = async ([url, type]) => (await browser.declarativeNetRequest.testMatchOutcome({url, type, initiator:"https://publisher.xad.test"})).matchedRules.length > 0;
        return { ads:await Promise.all(args.ads.map(check)), benign:await Promise.all(args.benign.map(check)) };
      }
      case "language": {
        const element = document.querySelector("#language");
        element.value = args;
        element.dispatchEvent(new Event("change", { bubbles:true }));
        await new Promise(resolve=>setTimeout(resolve,400));
        return { selected:document.documentElement.lang, saved:(await browser.storage.local.get("uiLanguage")).uiLanguage };
      }
      default: throw new Error("Unknown test command");
    }
  }
  for (;;) {
    try {
      const command = await (await fetch(endpoint + "/command")).json();
      let result;
      try { result = {id:command.id, value:await run(command)}; }
      catch(error) { result = {id:command.id,error:String(error.stack || error)}; }
      await fetch(endpoint + "/result", {method:"POST",body:JSON.stringify(result)});
    } catch (_) { await new Promise(resolve=>setTimeout(resolve,250)); }
  }
})();
