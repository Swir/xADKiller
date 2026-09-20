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

export function buildWitness(records, generatedAt = new Date().toISOString()) {
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

  const summary = {
    observations: observations.length,
    standard: observations.filter((item) => item.mode === "standard").length,
    ultra: observations.filter((item) => item.mode === "ultra").length,
    content_ok: observations.filter((item) => item.expected_content_ok).length,
    blocking_observed: observations.filter((item) => item.blocking_observed).length,
    breakage: observations.filter((item) => item.breakage).length,
    recovered: observations.filter((item) => item.breakage && item.recovery !== "none").length
  };

  return {
    schema: 1,
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
    release_gate_closed: true,
    summary,
    observations
  };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--input=")) out.input = arg.slice(8);
    else if (arg.startsWith("--output=")) out.output = arg.slice(9);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return "Usage: node tools/normal-browsing-beta-witness.mjs --input=observations.json --output=beta-witness.json";
}

function writeAtomic(target, data) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
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
    const raw = JSON.parse(fs.readFileSync(args.input, "utf8"));
    const records = Array.isArray(raw) ? raw : raw.observations;
    const witness = buildWitness(records);
    writeAtomic(args.output, `${JSON.stringify(witness, null, 2)}\n`);
    console.log(`Normal-browsing beta witness: ${witness.summary.observations} observations, ${witness.summary.breakage} breakage, ${witness.summary.recovered} recovered`);
    console.log("Privacy: hostnames hashed; URLs, paths, page titles and note contents omitted; release gate remains closed.");
  } catch (error) {
    console.error(`ERROR: ${error?.message || error}`);
    console.error(usage());
    process.exit(2);
  }
}
