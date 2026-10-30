import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "firefox");
const common = path.join(root, "common");
const snapshot = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, "firefox", "data-snapshot.json.gz"))));
if (snapshot.schema !== 1) throw new Error("Unknown data snapshot schema");
// Only this generated directory is replaced; Chrome output is kept intact.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(common)) {
  if (["service-worker.js", "compat-engine.js", "beta-review.js", "beta-review.html", "rules"].includes(name)) continue;
  const from = path.join(common, name);
  if (name === "_locales") {
    for (const locale of fs.readdirSync(from)) {
      const target = path.join(out, name, locale);
      fs.mkdirSync(target, {recursive:true});
      fs.writeFileSync(path.join(target,"messages.json"),fs.readFileSync(path.join(from,locale,"messages.json"),"utf8").replace(/\r\n/g,"\n"));
    }
  }
  else if (fs.statSync(from).isDirectory()) fs.cpSync(from, path.join(out, name), { recursive: true });
  else fs.writeFileSync(path.join(out, name), fs.readFileSync(from, "utf8").replace(/\r\n/g, "\n"));
}
for (const [name, text] of Object.entries(snapshot.files)) {
  const destination = path.resolve(out, name);
  if (!destination.startsWith(out + path.sep)) throw new Error("Invalid snapshot path");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // Compact JSON stays below AMO's per-file parser limit without changing rules.
  fs.writeFileSync(destination, name.endsWith(".json") ? JSON.stringify(JSON.parse(text)) + "\n" : text);
}
for (const name of ["manifest.json", "platform.js"]) {
  fs.writeFileSync(path.join(out, name), fs.readFileSync(path.join(root, "firefox", name), "utf8").replace(/\r\n/g, "\n"));
}
for (const name of ["THIRD_PARTY_NOTICES.txt", "licenses/GPL-3.0.txt", "licenses/StevenBlack-MIT.txt"]) {
  const destination=path.join(out,name);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,fs.readFileSync(path.join(root,"firefox",name),"utf8").replace(/\r\n/g,"\n"));
}
const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
// Keep the existing preflight ad-path protections available to DNR offline too.
const standardPath = path.join(out, "rules", "standard.json");
const standard = JSON.parse(fs.readFileSync(standardPath, "utf8"));
let nextId = Math.max(...standard.map(rule=>rule.id)) + 1;
for (const condition of JSON.parse(fs.readFileSync(path.join(root,"firefox","core-patterns.json"),"utf8"))) {
  standard.push({ id:nextId++, priority:60, action:{type:"block"}, condition });
}
fs.writeFileSync(standardPath, JSON.stringify(standard)+"\n");
const metaPath = path.join(out, "build-meta.js");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8").match(/(?:self|globalThis)\.XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;/)[1]);
meta.version = manifest.version;
meta.browser = "firefox";
meta.standardRules = standard.length;
meta.ultraRules = JSON.parse(snapshot.files["rules/ultra.json"]).length;
meta.sourceCommit = process.env.XAD_SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(meta.sourceCommit)) throw new Error("Invalid source commit");
fs.writeFileSync(metaPath, `self.XAD_BUILD_META=${JSON.stringify(meta)};\n`);
const popupPath = path.join(out, "popup.html");
fs.writeFileSync(popupPath, fs.readFileSync(popupPath, "utf8").replace("v1.5.0-dev", `v${manifest.version} • Firefox`));
// Prevalidated selectors can go straight to the CSS parser in both browsers.
const contentPath = path.join(out, "content.js");
const code = fs.readFileSync(contentPath, "utf8");
const slow = 'try { document.querySelector(selector); return `${selector}{display:none!important;visibility:hidden!important}`; } catch (_) { return ""; }';
if (!code.includes(slow)) throw new Error("Cosmetic optimization source changed");
fs.writeFileSync(contentPath, code.replace(slow, 'return `${selector}{display:none!important;visibility:hidden!important}`;'));
const backgroundPath = path.join(out, "background.js");
let background = fs.readFileSync(backgroundPath, "utf8");
background = background.replace('try { importScripts("build-meta.js"); } catch (_) {}', "// build-meta.js is loaded first by Firefox's background.scripts.");
const badge = '    try { chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch (_) {}';
if (!background.includes(badge)) throw new Error("Badge adapter source changed");
background = background.replace(badge, "    // Firefox does not expose a DNR action-count badge API.");
const statsStart = background.indexOf('  if (msg.type === "getNetworkStats") {');
const statsEnd = background.indexOf('  if (msg.type === "getDynamicShieldStats") {', statsStart);
if (statsStart < 0 || statsEnd < statsStart) throw new Error("Network stats adapter source changed");
background = background.slice(0, statsStart) + '  if (msg.type === "getNetworkStats") {\n    sendResponse({ ok:false, supported:false, count:null, error:"not_supported_in_firefox" });\n    return false;\n  }\n\n' + background.slice(statsEnd);
fs.writeFileSync(backgroundPath, background);
console.log(`Built Firefox ${manifest.version}: ${meta.standardRules} STANDARD + ${meta.ultraRules} ULTRA; ${meta.dynamicIntelDomains} domains grouped within Firefox DNR limits`);
