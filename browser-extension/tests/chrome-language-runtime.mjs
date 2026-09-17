import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function log(stage, extra = "") { console.log(`[xADKiller LANG CI] ${stage}${extra ? ` • ${extra}` : ""}`); }

const localeRoot = path.join(extensionPath, "_locales");
const locales = fs.readdirSync(localeRoot, { withFileTypes:true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (JSON.stringify(locales) !== JSON.stringify(["en","pl"])) throw new Error(`expected only en/pl locales, got ${locales.join(",")}`);

async function findWorker(browser, timeout = 22000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      if (target.type() !== "service_worker" || !target.url().startsWith("chrome-extension://")) continue;
      const worker = await target.worker();
      if (!worker) continue;
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
        if (manifest.version === "1.4.0" && manifest.name.includes("xADKiller")) return worker;
      } catch (_) {}
    }
    await delay(200);
  }
  throw new Error("xADKiller worker not found");
}

async function openPopup(browser, extensionId) {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil:"domcontentloaded", timeout:12000 });
  await popup.waitForSelector("#language", { timeout:12000 });
  return popup;
}

async function waitLanguage(popup, lang, protection) {
  await popup.waitForFunction((expectedLang, expectedProtection) => {
    const select = document.querySelector("#language");
    const label = document.querySelector('[data-i18n="protection"]');
    return select?.value === expectedLang && document.documentElement.lang === expectedLang && label?.textContent?.trim() === expectedProtection;
  }, { timeout:12000 }, lang, protection);
}

async function assertRuleBudget(popup, expectedTitle) {
  await popup.waitForFunction((title) => {
    const label = document.querySelector('[data-i18n="ruleBudget"]');
    const ids = ["ruleBudgetStandard","ruleBudgetUltra","ruleBudgetBoost","ruleBudgetRuntime"];
    const values = ids.map((id) => document.getElementById(id)?.textContent?.trim() || "");
    return label?.textContent?.trim() === title && values.every((value) => /^\d[\d\s,.]*$/.test(value));
  }, { timeout:12000 }, expectedTitle);
  const values = await popup.$$eval(".budgetGrid b", (nodes) => nodes.map((node) => node.textContent?.trim() || ""));
  if (values.length !== 4) throw new Error(`rule budget cell count mismatch: ${values.length}`);
  log("Rule budget UI OK", `${expectedTitle} • ${values.join("/")}`);
}

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless:true,
    pipe:true,
    enableExtensions:[extensionPath],
    args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check"],
    timeout:60000
  });
  const worker = await findWorker(browser);
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  log("Locales packaged", locales.join(","));

  let popup = await openPopup(browser, extensionId);
  const options = await popup.$$eval("#language option", (nodes) => nodes.map((node) => node.value));
  if (JSON.stringify(options) !== JSON.stringify(["en","pl"])) throw new Error(`language switch options mismatch: ${options.join(",")}`);

  await popup.select("#language", "pl");
  await waitLanguage(popup, "pl", "Ochrona");
  await assertRuleBudget(popup, "Budżet reguł");
  let stored = await worker.evaluate(async () => (await chrome.storage.local.get({ uiLanguage:"" })).uiLanguage);
  if (stored !== "pl") throw new Error(`Polish language preference not stored: ${stored}`);
  log("Polish switch OK", "Ochrona");
  await popup.close();

  popup = await openPopup(browser, extensionId);
  await waitLanguage(popup, "pl", "Ochrona");
  await assertRuleBudget(popup, "Budżet reguł");
  log("Polish persistence OK");

  await popup.select("#language", "en");
  await waitLanguage(popup, "en", "Protection");
  await assertRuleBudget(popup, "Rule Budget");
  stored = await worker.evaluate(async () => (await chrome.storage.local.get({ uiLanguage:"" })).uiLanguage);
  if (stored !== "en") throw new Error(`English language preference not stored: ${stored}`);
  log("English switch OK", "Protection");
  await popup.close();

  popup = await openPopup(browser, extensionId);
  await waitLanguage(popup, "en", "Protection");
  await assertRuleBudget(popup, "Rule Budget");
  log("PASS", "PL/EN switching, persistence and rule-budget diagnostics verified");
  await popup.close();
} finally {
  if (browser) { try { await browser.close(); } catch (_) {} }
}
