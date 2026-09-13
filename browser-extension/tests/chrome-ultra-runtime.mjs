import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const testHtml = fs.readFileSync(path.join(root, "tests", "test-page.html"));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(testHtml);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const userDataDir = fs.mkdtempSync("/tmp/xadkiller-chrome-ultra-");
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-sandbox"
  ]
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  if (!extensionId) throw new Error("could not resolve extension id");

  const meta = await worker.evaluate(() => self.XAD_BUILD_META || null);
  if (!meta || meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);
  if (meta.cosmeticGeneric < 250 || meta.cosmeticDomains < 50) throw new Error(`cosmetic build incomplete: ${JSON.stringify(meta)}`);

  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.waitForTimeout(1500);

  const normalVisible = await page.locator("#normal").isVisible();
  const cosmeticVisible = await page.locator("#cosmetic-ad").isVisible();
  const smartVisible = await page.locator("#sponsored-banner-unit").isVisible();
  const skipClicks = await page.evaluate(() => window.skipClicks);
  const blockTest = await page.evaluate(async () => await Promise.race([
    window.blockTest.then((v) => ({ state: "done", value: v })),
    new Promise((resolve) => setTimeout(() => resolve({ state: "timeout", value: false }), 5000))
  ]));

  if (!normalVisible) throw new Error("normal content was hidden");
  if (cosmeticVisible) throw new Error("cosmetic ad was not hidden");
  if (smartVisible) throw new Error("Smart DOM did not hide strong ad candidate");
  if (skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");
  if (blockTest.state === "timeout") throw new Error("DNR control request timed out instead of being blocked");
  if (!blockTest.value || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure captured"}`);

  // Exercise the real popup -> service-worker message path instead of messaging the worker to itself.
  const popup = await context.newPage();
  popup.setDefaultTimeout(10000);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await popup.selectOption("#mode", "ultra");
  await popup.waitForTimeout(600);

  const enabledRulesets = await worker.evaluate(async () => await chrome.declarativeNetRequest.getEnabledRulesets());
  if (!enabledRulesets.includes("standard") || !enabledRulesets.includes("ultra")) {
    throw new Error(`ULTRA rulesets not enabled through popup: ${enabledRulesets.join(",")}`);
  }

  const matched = await worker.evaluate(async (tabId) => {
    try {
      const details = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      return { ok: true, count: details?.rulesMatchedInfo?.length || 0 };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, page.context() === context ? await page.evaluate(() => 0).then(async () => {
    const pages = context.pages();
    // The tab ID is not exposed to Playwright; get the HTTP tab from Chrome itself.
    return await worker.evaluate(async (urlPart) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => (t.url || "").includes(urlPart))?.id || -1;
    }, `127.0.0.1:${port}`);
  }) : -1);
  if (!matched.ok) throw new Error(`getMatchedRules failed: ${matched.error || "unknown"}`);
  if (matched.count < 1) throw new Error("DNR reported zero matched rules for the test tab");

  console.log(`OK: Chrome Ultra runtime passed: STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetics=${meta.cosmeticGeneric}, scoped=${meta.cosmeticDomains}, matched=${matched.count}`);
} finally {
  await context.close();
  server.close();
}
