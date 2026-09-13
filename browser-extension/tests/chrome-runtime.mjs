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

const userDataDir = fs.mkdtempSync("/tmp/xadkiller-chrome-");
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-sandbox"
  ]
});

try {
  const page = await context.newPage();
  let dnrFailure = "";
  page.on("requestfailed", (request) => {
    if (request.url().includes("ads.xadkiller.test")) dnrFailure = request.failure()?.errorText || "";
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const normalVisible = await page.locator("#normal").isVisible();
  const adVisible = await page.locator("#cosmetic-ad").isVisible();
  const skipClicks = await page.evaluate(() => window.skipClicks);
  await page.evaluate(async () => await window.blockTest);

  if (!normalVisible) throw new Error("normal content was hidden");
  if (adVisible) throw new Error("cosmetic ad was not hidden");
  if (skipClicks < 1) throw new Error("Smart Auto-Skip did not click a clear Skip Ad button");
  if (!/ERR_BLOCKED_BY_CLIENT/i.test(dnrFailure)) throw new Error(`DNR did not report ERR_BLOCKED_BY_CLIENT: ${dnrFailure || "no failure captured"}`);

  console.log("OK: Chromium runtime test passed: DNR + cosmetic filtering + Smart Auto-Skip");
} finally {
  await context.close();
  server.close();
}
