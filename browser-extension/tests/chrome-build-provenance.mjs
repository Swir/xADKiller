import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist", "chrome");
const metaText = fs.readFileSync(path.join(dist, "build-meta.js"), "utf8").trim();
const match = metaText.match(/^(?:self|globalThis)\.XAD_BUILD_META\s*=\s*(\{[\s\S]*\})\s*;?$/);
if (!match) throw new Error("Could not parse stamped build-meta.js");
const meta = JSON.parse(match[1]);
const commitRe = /^[0-9a-f]{40}$/;
const expected = String(process.env.XAD_SOURCE_COMMIT || process.env.GITHUB_SHA || "").trim().toLowerCase();

if (commitRe.test(expected) && meta.sourceCommit !== expected) {
  throw new Error(`build source commit mismatch: ${meta.sourceCommit} != ${expected}`);
}
if (!commitRe.test(expected) && meta.sourceCommit !== "unbound" && !commitRe.test(String(meta.sourceCommit || ""))) {
  throw new Error(`invalid build source commit marker: ${meta.sourceCommit}`);
}

const html = fs.readFileSync(path.join(dist, "beta-review.html"), "utf8");
const provenance = fs.readFileSync(path.join(dist, "beta-build-provenance.js"), "utf8");
const buildMetaPos = html.indexOf('<script src="build-meta.js"></script>');
const provenancePos = html.indexOf('<script src="beta-build-provenance.js"></script>');
const reviewPos = html.indexOf('<script src="beta-review.js"></script>');
if (!(buildMetaPos >= 0 && provenancePos > buildMetaPos && reviewPos > provenancePos)) {
  throw new Error("beta review provenance scripts are missing or ordered incorrectly");
}
if (!provenance.includes('document.getElementById("sourceCommit")')) throw new Error("source commit input binding missing");
if (!provenance.includes("input.readOnly = true")) throw new Error("build-bound source commit must be read-only");
if (/\bfetch\s*\(|XMLHttpRequest|https?:\/\//i.test(provenance)) throw new Error("build provenance helper must remain local-only");

console.log(`Chrome build provenance: PASS (${String(meta.sourceCommit).slice(0, 12)})`);
