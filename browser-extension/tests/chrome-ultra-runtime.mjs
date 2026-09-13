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

  const meta = await worker.evaluate(() => self.XAD_BUILD_META || null);
  if (!meta || meta.standardRules < 1000 || meta.ultraRules < 1000) throw new Error(`invalid build meta: ${JSON.stringify(meta)}`);

  const page = await context.newPage();
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const normalVisible = await page.locator("#normal").isVisible();
  const cosmeticVisible = await page.locator("#cosmetic-ad").isVisible();
  const smartVisible = await page.locator("#sponsored-banner-unit").isVisible();
  const skipClicks = await page.evaluate(() => window.skipClicks);
  const blockTest = await page.evaluate(async () => await window.blockTest);

  if (!normalVisible) throw new Error("normal content was hidden");
  if (cosmeticVisible) throw new Error("cosmetic ad was not hidden");
  if (smartVisible) throw new Error("Smart DOM did not hide strong ad candidate");
  if (skipClicks < 1) throw new Error("Smart Auto-Skip did not click Skip Ad");
  if (!blockTest || !/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR block failed: ${dnrFailure || "no failure captured"}`);

  const switchResult = await worker.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "setMode", mode: "ultra" });
    await new Promise((r) => setTimeout(r, 150));
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    return { response, enabled };
  });
  if (!switchResult.response?.ok) throw new Error(`ULTRA mode switch failed: ${JSON.stringify(switchResult)}`);
  if (!switchResult.enabled.includes("standard") || !switchResult.enabled.includes("ultra")) throw new Error(`ULTRA rulesets not enabled: ${switchResult.enabled}`);

  const stats = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return null;
    return await chrome.runtime.sendMessage({ type: "getNetworkStats", tabId });
  });
  if (stats && stats.ok === false) throw new Error(`network stats failed: ${stats.error || "unknown"}`);

  console.log(`OK: Chrome Ultra runtime passed: STANDARD=${meta.standardRules}, ULTRA=${meta.ultraRules}, cosmetics=${meta.cosmeticGeneric}`);
} finally {
  await context.close();
  server.close();
}
