import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWitness, normalizeHostname } from "../tools/normal-browsing-beta-witness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.resolve(here, "../tools/normal-browsing-beta-witness.mjs");

assert.equal(normalizeHostname("News.Example.COM."), "news.example.com");
assert.throws(() => normalizeHostname("https://news.example.com/path"), /must not contain/);
assert.throws(() => normalizeHostname("localhost"), /public-style hostname/);

const input = [
  {
    host: "news.example.com",
    mode: "standard",
    page_type: "news",
    expected_content_ok: true,
    blocking_observed: true,
    breakage: false,
    recovery: "none",
    note: "article and consent flow looked normal"
  },
  {
    host: "checkout.example.org",
    mode: "ultra",
    page_type: "checkout",
    expected_content_ok: true,
    blocking_observed: true,
    breakage: true,
    recovery: "heuristic_pause",
    note: "safe recovery restored the page"
  }
];

const witness = buildWitness(input, "2026-09-20T00:00:00Z");
assert.equal(witness.schema, 2);
assert.equal(witness.release_gate_closed, false);
assert.equal(witness.manual_beta_review_ready, false);
assert.equal(witness.summary.observations, 2);
assert.equal(witness.summary.standard, 1);
assert.equal(witness.summary.ultra, 1);
assert.equal(witness.summary.breakage, 1);
assert.equal(witness.summary.recovered, 1);
assert.equal(witness.summary.unrecovered_breakage, 0);
assert.equal(witness.privacy.telemetry, false);
assert.equal(witness.candidate.bound, false);
assert.equal(witness.observations[0].host_hash.length, 16);
assert.equal(witness.observations[1].note_present, true);
const serialized = JSON.stringify(witness);
assert(!serialized.includes("news.example.com"));
assert(!serialized.includes("checkout.example.org"));
assert(!serialized.includes("article and consent flow"));
assert(!serialized.includes("safe recovery restored"));
assert(!serialized.includes("https://"));

assert.throws(() => buildWitness([{ ...input[0], recovery: "site_pause" }]), /recovery requires breakage/);
assert.throws(() => buildWitness([{ ...input[0], mode: "compat" }]), /mode is invalid/);
assert.throws(
  () => buildWitness(input, "2026-09-20T00:00:00Z", { source_commit: "abc", package_sha256: "0".repeat(64) }),
  /source_commit/
);

const reviewInput = [
  ["news1.example.com", "standard", "news"],
  ["news2.example.com", "standard", "news"],
  ["video1.example.com", "standard", "video"],
  ["video2.example.com", "standard", "video"],
  ["shop1.example.com", "ultra", "shop"],
  ["shop2.example.com", "ultra", "shop"],
  ["login1.example.com", "ultra", "login"],
  ["search1.example.com", "ultra", "search"]
].map(([host, mode, page_type], index) => ({
  host,
  mode,
  page_type,
  expected_content_ok: true,
  blocking_observed: index % 2 === 0,
  breakage: false,
  recovery: "none"
}));

const bound = buildWitness(reviewInput, "2026-09-20T00:00:00Z", {
  source_commit: "a".repeat(40),
  package_sha256: "b".repeat(64)
});
assert.equal(bound.manual_beta_review_ready, true);
assert.equal(bound.release_gate_closed, false);
assert.equal(bound.candidate.bound, true);
assert.equal(bound.summary.unique_hosts, 8);
assert.equal(bound.summary.page_types, 5);

const unrecovered = buildWitness(
  reviewInput.map((item, index) => index === 0 ? { ...item, breakage: true, recovery: "none" } : item),
  "2026-09-20T00:00:00Z",
  { source_commit: "a".repeat(40), package_sha256: "b".repeat(64) }
);
assert.equal(unrecovered.manual_beta_review_ready, false);
assert.equal(unrecovered.summary.unrecovered_breakage, 1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xadkiller-beta-witness-"));
const inputPath = path.join(dir, "observations.json");
const outputPath = path.join(dir, "witness.json");
const packagePath = path.join(dir, "tested.zip");
fs.writeFileSync(inputPath, JSON.stringify({ observations: reviewInput }), "utf8");
fs.writeFileSync(packagePath, Buffer.from("tested package fixture\n", "utf8"));
const cli = spawnSync(process.execPath, [
  tool,
  `--input=${inputPath}`,
  `--output=${outputPath}`,
  `--source-commit=${"c".repeat(40)}`,
  `--package=${packagePath}`
], { encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const fromDisk = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(fromDisk.release_gate_closed, false);
assert.equal(fromDisk.manual_beta_review_ready, true);
assert.equal(fromDisk.candidate.bound, true);
assert.match(fromDisk.candidate.package_sha256, /^[0-9a-f]{64}$/);
assert.equal(fromDisk.summary.observations, 8);
assert(!JSON.stringify(fromDisk).includes("news1.example.com"));

const badPath = path.join(dir, "bad.json");
fs.writeFileSync(badPath, JSON.stringify([{ ...input[0], host: "https://bad.example/path?q=1" }]), "utf8");
const bad = spawnSync(process.execPath, [tool, `--input=${badPath}`, `--output=${path.join(dir, "bad-out.json")}`], {
  encoding: "utf8"
});
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /must not contain a URL, path, credentials, query or fragment/);

const mismatch = spawnSync(process.execPath, [
  tool,
  `--input=${inputPath}`,
  `--output=${path.join(dir, "mismatch.json")}`,
  `--source-commit=${"c".repeat(40)}`,
  `--package=${packagePath}`,
  `--package-sha256=${"0".repeat(64)}`
], { encoding: "utf8" });
assert.notEqual(mismatch.status, 0);
assert.match(mismatch.stderr, /package SHA-256 mismatch/);

console.log("Normal-browsing beta witness privacy/provenance/release-gate regression: PASS");
