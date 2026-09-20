import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
const metaPath = path.join(out, "build-meta.js");
const text = fs.readFileSync(metaPath, "utf8").trim();
const match = text.match(/^(?:self|globalThis)\.XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;?$/);
if (!match) throw new Error("Could not parse build-meta.js");
const meta = JSON.parse(match[1]);
const COMMIT_RE = /^[0-9a-f]{40}$/;

function resolveSourceCommit() {
  for (const value of [process.env.XAD_SOURCE_COMMIT, process.env.GITHUB_SHA]) {
    const candidate = String(value || "").trim().toLowerCase();
    if (COMMIT_RE.test(candidate)) return candidate;
  }
  try {
    const candidate = String(execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }) || "").trim().toLowerCase();
    if (COMMIT_RE.test(candidate)) return candidate;
  } catch {}
  return "unbound";
}

meta.version = manifest.version;
meta.sourceCommit = resolveSourceCommit();
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
const boostPath = path.join(out, "titan-boost-meta.json");
if (fs.existsSync(boostPath)) {
  const boost = JSON.parse(fs.readFileSync(boostPath, "utf8"));
  meta.titanBoostRules = Number(boost.total || 0);
  meta.titanBoostSets = Array.isArray(boost.counts) ? boost.counts : [];
}
fs.writeFileSync(metaPath, `self.XAD_BUILD_META=${JSON.stringify(meta)};\n`);

const betaReviewHtmlPath = path.join(out, "beta-review.html");
const betaProvenancePath = path.join(out, "beta-build-provenance.js");
const betaReviewMarker = '<script src="beta-review.js"></script>';
if (!fs.existsSync(betaReviewHtmlPath)) throw new Error("beta-review.html missing from Chrome package");
let betaReviewHtml = fs.readFileSync(betaReviewHtmlPath, "utf8");
if (!betaReviewHtml.includes(betaReviewMarker)) throw new Error("beta-review script marker missing");
const provenanceScripts = '<script src="build-meta.js"></script>\n<script src="beta-build-provenance.js"></script>\n' + betaReviewMarker;
if (!betaReviewHtml.includes('src="beta-build-provenance.js"')) {
  betaReviewHtml = betaReviewHtml.replace(betaReviewMarker, provenanceScripts);
  fs.writeFileSync(betaReviewHtmlPath, betaReviewHtml);
}
fs.writeFileSync(betaProvenancePath, `(() => {\n  "use strict";\n  const commit = String(globalThis.XAD_BUILD_META?.sourceCommit || "").trim().toLowerCase();\n  if (!/^[0-9a-f]{40}$/.test(commit)) return;\n  const input = document.getElementById("sourceCommit");\n  if (!input) return;\n  input.value = commit;\n  input.readOnly = true;\n  input.setAttribute("aria-readonly", "true");\n  input.dataset.buildBound = "true";\n})();\n`);

console.log(`OK: stamped build metadata version=${meta.version}, sourceCommit=${meta.sourceCommit}, dynamicIntelDomains=${meta.dynamicIntelDomains || 0}, titanSessionRules=${meta.titanSessionRules || 0}, titanBoostRules=${meta.titanBoostRules || 0}`);
