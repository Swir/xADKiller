import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "chrome", "manifest.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "common", "beta-review.html"), "utf8");
const js = fs.readFileSync(path.join(root, "common", "beta-review.js"), "utf8");

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(manifest.options_ui?.page === "beta-review.html", "Chrome manifest must expose beta-review.html as development options UI");
expect(manifest.options_ui?.open_in_tab === true, "beta review must open in its own tab");
expect(!manifest.permissions.includes("tabs"), "beta review must not add broad tabs permission");
expect(!manifest.permissions.includes("downloads"), "beta review must not add downloads permission");
expect(/<script src="beta-review\.js"><\/script>/.test(html), "beta review script missing");
expect(!/https?:\/\//i.test(html), "beta review HTML must not load remote resources");
expect(js.includes('crypto.subtle.digest("SHA-256"'), "hostnames must be hashed locally with SHA-256");
expect(js.includes("host_hash"), "witness must store a host hash");
expect(js.includes('source_commit: "unbound"') && js.includes('package_sha256: "unbound"'), "local witness must not invent candidate provenance");
expect(js.includes("release_gate_closed: false"), "local witness must never close the release gate");
expect(js.includes("minObservations: 8") && js.includes("minUniqueHosts: 6") && js.includes("minPageTypes: 4") && js.includes("minPerMode: 2"), "manual beta coverage thresholds drifted");
expect(!js.includes("chrome.tabs"), "beta helper must not inspect browser tab URLs");
expect(!/\bfetch\s*\(/.test(js) && !js.includes("XMLHttpRequest"), "beta helper must remain local-only with no network upload path");
expect(js.includes('urls: "omitted"') && js.includes("paths_queries_fragments"), "privacy declaration missing URL/path omission");
expect(html.includes("data-pl=") && html.includes("data-en="), "PL/EN copy must remain present");

console.log("Chrome local beta review contract: PASS");
