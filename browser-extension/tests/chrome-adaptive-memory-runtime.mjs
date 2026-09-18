import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xadkiller-memory-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (stage, extra = "") => console.log(`[xADKiller MEMORY CI] ${stage}${extra ? ` • ${extra}` : ""}`);

async function launch() {
  return await puppeteer.launch({
    executablePath:chromium.executablePath(),
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    userDataDir:profile,
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],
    timeout:60000
  });
}

async function findWorker(browser, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest?.name?.includes("xADKiller") && manifest?.permissions?.includes("declarativeNetRequest")) {
          return { worker, extensionId:await worker.evaluate(() => chrome.runtime.id) };
        }
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller service worker not found");
}

async function openPopup(browser, extensionId) {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.waitForSelector("#mode", { timeout:12000 });
  return popup;
}

async function send(popup, message) {
  return await popup.evaluate(async (payload) => await chrome.runtime.sendMessage(payload), message);
}

async function waitStats(popup, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await send(popup, { type:"getTitanStats" });
    if (last?.ok && predicate(last)) return last;
    await delay(250);
  }
  throw new Error(`Adaptive Memory state timeout: ${JSON.stringify(last)}`);
}

async function startLocalFixture() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url?.startsWith("/?")) {
        res.writeHead(200, { "content-type":"text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body><img src="/ads/banner.png"><script src="/adserver/runtime.js"></script></body></html>`);
        return;
      }
      if (req.url === "/ads/banner.png") {
        res.writeHead(204, { "content-type":"image/png" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type":"application/javascript; charset=utf-8" });
      res.end("globalThis.__xadLocalFixtureLoaded=true;");
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port:typeof address === "object" && address ? address.port : 0 });
    });
  });
}

let browser = null;
let localFixture = null;
try {
  browser = await launch();
  let found = await findWorker(browser);
  let popup = await openPopup(browser, found.extensionId);

  // Wait for the initial service-worker refresh to settle before testing a
  // read-modify-write memory sequence. This isolates Adaptive Memory itself
  // from the deliberately concurrent startup feed/session refresh.
  const ready = await waitStats(popup, (s) => s.session >= 1200 && s.regex >= 1, 20000);
  log("Startup settled", JSON.stringify(ready));
  const mode = await send(popup, { type:"setMode", mode:"ultra" });
  if (!mode?.ok || mode.mode !== "ultra") throw new Error(`could not enter ULTRA: ${JSON.stringify(mode)}`);
  await delay(500);

  // Network Scout must never learn private/local browsing context. A first-party
  // /ads/ or /adserver/ path on a loopback/LAN/private hostname is not evidence of
  // public ad-tech and persisting it could break routers, NAS/admin panels or local apps.
  const beforeLocal = await send(popup, { type:"getTitanStats" });
  if (!beforeLocal?.ok) throw new Error(`could not read memory before local fixture: ${JSON.stringify(beforeLocal)}`);
  localFixture = await startLocalFixture();
  if (!localFixture.port) throw new Error("local fixture did not bind a port");
  const localPage = await browser.newPage();
  await localPage.goto(`http://127.0.0.1:${localFixture.port}/`, { waitUntil:"networkidle0", timeout:12000 });
  await delay(1200);
  await localPage.close();
  await new Promise((resolve) => localFixture.server.close(resolve));
  localFixture = null;
  const afterLocal = await send(popup, { type:"getTitanStats" });
  if (!afterLocal?.ok || afterLocal.memory !== beforeLocal.memory || afterLocal.learned !== beforeLocal.learned) {
    throw new Error(`local/private resource leaked into Adaptive Memory: before=${JSON.stringify(beforeLocal)} after=${JSON.stringify(afterLocal)}`);
  }
  log("Local/private learning guard", `memory=${afterLocal.memory} learned=${afterLocal.learned}`);

  const sample = { type:"titanLearnResource", url:"https://cdn-adnxs.example.net/runtime/ad.js", pageHost:"example.org" };
  const first = await send(popup, sample);
  if (!first?.ok || first.memorySeen !== 1 || first.promoted !== false) throw new Error(`first memory observation invalid: ${JSON.stringify(first)}`);
  log("First observation", JSON.stringify(first));

  const second = await send(popup, sample);
  if (!second?.ok || second.memorySeen < 2 || second.promoted !== true) throw new Error(`second memory observation did not promote: ${JSON.stringify(second)}`);
  log("Promotion", JSON.stringify(second));

  const learned = await waitStats(popup, (s) => s.memory >= 1 && s.promoted >= 1 && s.learned >= 1);
  log("Promoted memory active", JSON.stringify(learned));

  const stored = await found.worker.evaluate(async () => await chrome.storage.local.get({ xadTitanHostMemoryV1:[] }));
  const rawText = JSON.stringify(stored.xadTitanHostMemoryV1 || []);
  if (!Array.isArray(stored.xadTitanHostMemoryV1) || stored.xadTitanHostMemoryV1.length !== 1) throw new Error(`unexpected memory storage: ${rawText}`);
  if (!rawText.includes("cdn-adnxs.example.net")) throw new Error(`learned host missing from memory: ${rawText}`);
  if (rawText.includes("example.org") || rawText.includes("/runtime/ad.js") || rawText.includes("https://")) throw new Error(`memory leaked browsing/page URL context: ${rawText}`);
  log("Privacy storage shape OK", rawText);

  await popup.close();
  await browser.close();
  browser = null;

  browser = await launch();
  found = await findWorker(browser);
  popup = await openPopup(browser, found.extensionId);
  const modeAfterRestart = await send(popup, { type:"setMode", mode:"ultra" });
  if (!modeAfterRestart?.ok) throw new Error(`could not restore ULTRA after restart: ${JSON.stringify(modeAfterRestart)}`);
  const restored = await waitStats(popup, (s) => s.memory >= 1 && s.promoted >= 1 && s.learned >= 1, 18000);
  log("Memory restored after browser restart", JSON.stringify(restored));

  const reset = await send(popup, { type:"resetTitanMemory" });
  if (!reset?.ok) throw new Error(`reset rejected: ${JSON.stringify(reset)}`);
  const cleared = await waitStats(popup, (s) => s.memory === 0 && s.promoted === 0 && s.learned === 0, 8000);
  log("Reset verified", JSON.stringify(cleared));

  const finalStore = await found.worker.evaluate(async () => await chrome.storage.local.get({ xadTitanHostMemoryV1:[] }));
  if (finalStore.xadTitanHostMemoryV1?.length) throw new Error(`memory storage not cleared: ${JSON.stringify(finalStore)}`);

  log("PASS", "persistent host-only memory, local/private exclusion, restart restore and user reset all verified");
} finally {
  if (localFixture?.server) { try { await new Promise((resolve) => localFixture.server.close(resolve)); } catch (_) {} }
  if (browser) { try { await browser.close(); } catch (_) {} }
  try { fs.rmSync(profile, { recursive:true, force:true }); } catch (_) {}
}
