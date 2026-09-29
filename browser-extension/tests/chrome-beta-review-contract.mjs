import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "chrome", "manifest.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "common", "beta-review.html"), "utf8");
const js = fs.readFileSync(path.join(root, "common", "beta-review.js"), "utf8");
const betaChannel = fs.readFileSync(path.join(root, "common", "feed-v2-beta-channel.js"), "utf8");

function expect(value, message) {
  if (!value) throw new Error(message);
}

function pinnedRef(source, label) {
  const match = source.match(/const\s+(?:FEED_V2_)?PINNED_REF\s*=\s*"([0-9a-f]{40})"/);
  expect(match, `${label} must expose one immutable 40-hex pinned v2 commit`);
  return match[1];
}

expect(manifest.options_ui?.page === "beta-review.html", "Chrome manifest must expose beta-review.html as development options UI");
expect(manifest.options_ui?.open_in_tab === true, "beta review must open in its own tab");
expect(!manifest.permissions.includes("tabs"), "beta review must not add broad tabs permission");
expect(!manifest.permissions.includes("downloads"), "beta review must not add downloads permission");
expect(/<script src="beta-review\.js"><\/script>/.test(html), "beta review script missing");
expect(!/https?:\/\//i.test(html), "beta review HTML must not load remote resources");
expect(html.includes('id="sourceCommit"') && html.includes('id="packageFile"') && html.includes('id="candidateStatus"'), "tested candidate binding UI missing");
expect(js.includes('crypto.subtle.digest("SHA-256"'), "hostnames/package must be hashed locally with SHA-256");
expect(js.includes("host_hash"), "witness must store a host hash");
expect(js.includes("file.arrayBuffer()"), "tested ZIP must be hashed from local bytes");
expect(js.includes("MAX_PACKAGE_BYTES = 100 * 1024 * 1024"), "tested ZIP size bound drifted");
expect(js.includes("FEED_V2_RUNTIME_FRESH_MS = 30 * 60 * 1000"), "feed-v2 evidence freshness bound drifted");
expect(js.includes('integrity === "git-blob-sha1"'), "manual beta gate must require exact-byte v2 integrity evidence");
expect(js.includes("validation_ready:active && validatedFeeds === 3"), "manual beta gate must require all three pinned-v2 feeds");
expect(js.includes("manual_beta_review_ready:manualBetaReviewReady"), "export must expose combined manual beta readiness");
expect(js.includes("candidate.bound"), "manual beta readiness must require bound candidate provenance");
expect(js.includes("source_commit") && js.includes("package_sha256"), "candidate provenance fields missing");
expect(js.includes("release_gate_closed:false"), "local witness must never close the release gate");
expect(js.includes("minObservations: 8") && js.includes("minUniqueHosts: 6") && js.includes("minPageTypes: 4") && js.includes("minPerMode: 2"), "manual beta coverage thresholds drifted");
expect(!js.includes("chrome.tabs"), "beta helper must not inspect browser tab URLs");
expect(!/\bfetch\s*\(/.test(js) && !js.includes("XMLHttpRequest"), "beta helper must remain local-only with no network upload path");
expect(js.includes('urls:"omitted"') && js.includes("paths_queries_fragments"), "privacy declaration missing URL/path omission");
expect(html.includes("data-pl=") && html.includes("data-en="), "PL/EN copy must remain present");
expect(html.includes('id="feedV2Enable"') && html.includes('id="feedV2Disable"'), "pinned-v2 beta controls missing");

const reviewPin = pinnedRef(js, "beta review UI");
const runtimePin = pinnedRef(betaChannel, "feed-v2 runtime channel");
expect(reviewPin === runtimePin, `beta review/runtime pinned-ref drift: ${reviewPin} != ${runtimePin}`);
expect(js.includes("FEED_V2_MAX_SESSION_MS = 6 * 60 * 60 * 1000"), "pinned-v2 beta session must remain short-lived");
expect(js.includes("feed_v2_beta:feedV2"), "exported witness must include sanitized feed-v2 beta state");
expect(!js.includes("raw.githubusercontent.com") && !js.includes("github.com/"), "beta review UI must not own remote feed URLs");

console.log(`Chrome local beta review contract: PASS (bound ZIP + fresh 3/3 exact-byte v2 evidence, pin ${reviewPin.slice(0, 12)})`);
