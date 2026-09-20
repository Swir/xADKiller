#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODES = new Set(["standard", "ultra"]);
const PAGE_TYPES = new Set(["news", "video", "shop", "login", "checkout", "search", "social", "other"]);
const RECOVERY = new Set(["none", "heuristic_pause", "site_pause", "allowlist"]);
const MAX_RECORDS = 200;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const REVIEW_MIN_OBSERVATIONS = 8;
const REVIEW_MIN_UNIQUE_HOSTS = 6;
const REVIEW_MIN_PAGE_TYPES = 4;
const REVIEW_MIN_PER_MODE = 2;

export function normalizeHostname(value) {
  if (typeof value !== "string") throw new Error("host must be a string");
  let host = value.trim().toLowerCase();
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (!host || host.length > 253) throw new Error("host length is invalid");
  if (/[\s\/@?#]/.test(host) || host.includes("://")) throw new Error("host must not contain a URL, path, credentials, query or fragment");
  const labels = host.split(".");
  if (labels.length < 2) throw new Error("host must be a public-style hostname, not a local label");
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error(`invalid hostname label: ${label}`);
  }
  return host;
}

function bool(record, key) {
  if (typeof record[key] !== "boolean") throw new Error(`${key} must be boolean`);
  return record[key];
}

function enumValue(record, key, allowed) {
  const value = String(record[key] ?? "").trim().toLowerCase();
  if (!allowed.has(value)) throw new Error(`${key} is invalid: ${value || "<empty>"}`);
  return value;
}

function hashHost(host) {
  return crypto.createHash("sha256").update(host, "utf8").digest("hex").slice(0, 16);
}

function normalizeCandidate(provenance = {}) {
  const sourceCommit = String(provenance.source_commit ?? "").trim().toLowerCase();
  const packageSha256 = String(provenance.package_sha256 ?? "").trim().toLowerCase();

  if (sourceCommit && !COMMIT_RE.test(sourceCommit)) {
    throw new Error("source_commit must be a 40-character lowercase hex Git commit");
  }
  if (packageSha256 && !SHA256_RE.test(packageSha256)) {
    throw new Error("package_sha256 must be a 64-character lowercase hex SHA-256");
  }

  return {
    source_commit: sourceCommit || "unbound",
    package_sha256: packageSha256 || "unbound",
    bound: Boolean(sourceCommit && packageSha256)
  };
}

export function buildWitness(records, generatedAt = new Date().toISOString(), provenance = {}) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_RECORDS) {
    throw new Error(`observations must contain 1..${MAX_RECORDS} records`);
  }
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generatedAt must be ISO-like datetime");

  const observations = records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`record ${index + 1} must be an object`);
    const host = normalizeHostname(record.host);
    const mode = enumValue(record, "mode", MODES);
    const pageType = enumValue(record, "page_type", PAGE_TYPES);
    const recovery = enumValue(record, "recovery", RECOVERY);
    const expectedContentOk = bool(record, "expected_content_ok");
    const blockingObserved = bool(record, "blocking_observed");
    const breakage = bool(record, "breakage");
    if (recovery !== "none" && !breakage) throw new Error(`record ${index + 1}: recovery requires breakage=true`);
    if (typeof record.note === "string" && record.note.length > 240) throw new Error(`record ${index + 1}: note exceeds 240 characters`);

    return {
      host_hash: hashHost(host),
      mode,
      page_type: pageType,
      expected_content_ok: expectedContentOk,
      blocking_observed: blockingObserved,
      breakage,
      recovery,
      note_present: typeof record.note === "string" && record.note.trim().length > 0
    };
  });

  const uniqueHosts = new Set(observations.map((item) => item.host_hash)).size;
  const pageTypes = new Set(observations.map((item) => item.page_type)).size;
  const standard = observations.filter((item) => item.mode === "standard").length;
  const ultra = observations.filter((item) => item.mode === "ultra").length;
  const contentOk = observations.filter((item) => item.expected_content_ok).length;
  const blockingObserved = observations.filter((item) => item.blocking_observed).length;
  const breakage = observations.filter((item) => item.breakage).length;
  const recovered = observations.filter((item) => item.breakage && item.recovery !== "none").length;
  const unrecoveredBreakage = observations.filter((item) => item.breakage && item.recovery === "none").length;
  const contentFailures = observations.length - contentOk;
  const candidate = normalizeCandidate(provenance);
  const reviewReady =
    candidate.bound &&
    observations.length >= REVIEW_MIN_OBSERVATIONS &&
    uniqueHosts >= REVIEW_MIN_UNIQUE_HOSTS &&
    pageTypes >= REVIEW_MIN_PAGE_TYPES &&
    standard >= REVIEW_MIN_PER_MODE &&
    ultra >= REVIEW_MIN_PER_MODE &&
    contentFailures === 0 &&
    unrecoveredBreakage === 0;

  const summary = {
    observations: observations.length,
    unique_hosts: uniqueHosts,
    page_types: pageTypes,
    standard,
    ultra,
    content_ok: contentOk,
    content_failures: contentFailures,
    blocking_observed: blockingObserved,
    breakage,
    recovered,
    unrecovered_breakage: unrecoveredBreakage
  };

  return {
    schema: 2,
    generated_at: new Date(generatedAt).toISOString(),
    scope: "xADKiller Chrome v1.5 normal-browsing beta witness",
    privacy: {
      hostnames: "sha256-prefix-16",
      urls: "omitted",
      paths_queries_fragments: "omitted",
      page_titles: "omitted",
      notes: "omitted-content-only-presence-retained",
      telemetry: false
    },
    candidate,
    review_requirements: {
      min_observations: REVIEW_MIN_OBSERVATIONS,
      min_unique_hosts: REVIEW_MIN_UNIQUE_HOSTS,
      min_page_types: REVIEW_MIN_PAGE_TYPES,
      min_per_mode: REVIEW_MIN_PER_MODE,
      require_bound_candidate: true,
      require_zero_content_failures: true,
      require_zero_unrecovered_breakage: true
    },
    manual_beta_review_ready: reviewReady,
    release_gate_closed: false,
    summary,
    observations
  };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--input=")) out.input = arg.slice(8);
    else if (arg.startsWith("--output=")) out.output = arg.slice(9);
    else if (arg.startsWith("--source-commit=")) out.sourceCommit = arg.slice(16);
    else if (arg.startsWith("--package-sha256=")) out.packageSha256 = arg.slice(17);
    else if (arg.startsWith("--package=")) out.package = arg.slice(10);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return "Usage: node tools/normal-browsing-beta-witness.mjs --input=observations.json --output=beta-witness.json [--source-commit=<40hex>] [--package=ZIP|--package-sha256=<64hex>]";
}

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(target, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function writeAtomic(target, data) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, data, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, target);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.input || !args.output) throw new Error("--input and --output are required");

    let packageSha256 = args.packageSha256 || "";
    if (args.package) {
      if (!fs.existsSync(args.package)) throw new Error(`package not found: ${args.package}`);
      const computed = sha256File(args.package);
      if (packageSha256 && packageSha256.toLowerCase() !== computed) {
        throw new Error(`package SHA-256 mismatch (${computed} != ${packageSha256.toLowerCase()})`);
      }
      packageSha256 = computed;
    }

    const raw = JSON.parse(fs.readFileSync(args.input, "utf8"));
    const records = Array.isArray(raw) ? raw : raw.observations;
    const witness = buildWitness(records, new Date().toISOString(), {
      source_commit: args.sourceCommit || "",
      package_sha256: packageSha256
    });
    writeAtomic(args.output, `${JSON.stringify(witness, null, 2)}\n`);
    console.log(
      `Normal-browsing beta witness: ${witness.summary.observations} observations, ` +
      `${witness.summary.unique_hosts} unique hosts, ${witness.summary.breakage} breakage, ` +
      `${witness.summary.recovered} recovered`
    );
    console.log(
      `Manual beta review ready: ${witness.manual_beta_review_ready ? "YES" : "NO"}; ` +
      "release gate remains closed pending human review and the remaining release checks."
    );
    console.log("Privacy: hostnames hashed; URLs, paths, page titles and note contents omitted; no telemetry.");
  } catch (error) {
    console.error(`ERROR: ${error?.message || error}`);
    console.error(usage());
    process.exit(2);
  }
}
