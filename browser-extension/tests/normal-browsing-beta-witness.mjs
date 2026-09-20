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
assert.equal(witness.schema, 1);
assert.equal(witness.release_gate_closed, true);
assert.equal(witness.summary.observations, 2);
assert.equal(witness.summary.standard, 1);
assert.equal(witness.summary.ultra, 1);
assert.equal(witness.summary.breakage, 1);
assert.equal(witness.summary.recovered, 1);
assert.equal(witness.privacy.telemetry, false);
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xadkiller-beta-witness-"));
const inputPath = path.join(dir, "observations.json");
const outputPath = path.join(dir, "witness.json");
fs.writeFileSync(inputPath, JSON.stringify({ observations: input }), "utf8");
const cli = spawnSync(process.execPath, [tool, `--input=${inputPath}`, `--output=${outputPath}`], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const fromDisk = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(fromDisk.release_gate_closed, true);
assert.equal(fromDisk.summary.observations, 2);
assert(!JSON.stringify(fromDisk).includes("checkout.example.org"));

const badPath = path.join(dir, "bad.json");
fs.writeFileSync(badPath, JSON.stringify([{ ...input[0], host: "https://bad.example/path?q=1" }]), "utf8");
const bad = spawnSync(process.execPath, [tool, `--input=${badPath}`, `--output=${path.join(dir, "bad-out.json")}`], {
  encoding: "utf8"
});
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /must not contain a URL, path, credentials, query or fragment/);

console.log("Normal-browsing beta witness privacy/schema regression: PASS");
