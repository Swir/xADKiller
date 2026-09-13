import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
const metaPath = path.join(out, "build-meta.js");
const text = fs.readFileSync(metaPath, "utf8").trim();
const match = text.match(/^(?:self|globalThis)\.XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;?$/);
if (!match) throw new Error("Could not parse build-meta.js");
const meta = JSON.parse(match[1]);
meta.version = manifest.version;
const intelPath = path.join(out, "dynamic-intel-meta.json");
if (fs.existsSync(intelPath)) {
  const intel = JSON.parse(fs.readFileSync(intelPath, "utf8"));
  meta.dynamicIntelDomains = Number(intel.domains || 0);
  meta.dynamicIntelStrategy = String(intel.strategy || "");
}
const titanPath = path.join(out, "titan-session-meta.json");
if (fs.existsSync(titanPath)) {
  const titan = JSON.parse(fs.readFileSync(titanPath, "utf8"));
  meta.titanSessionRules = Number(titan.rules || 0);
}
fs.writeFileSync(metaPath, `self.XAD_BUILD_META=${JSON.stringify(meta)};\n`);
console.log(`OK: stamped build metadata version=${meta.version}, dynamicIntelDomains=${meta.dynamicIntelDomains || 0}, titanSessionRules=${meta.titanSessionRules || 0}`);
