#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PINNED_REF = "0930f563b4a4bfdef67885988485bfa8c7646784";
export const EXPECTED_BLOBS = Object.freeze({
  "live-shield":"1e2931556cd6d888fd50da92d04266512a213fc7",
  "live-matrix":"a10298b6d9004f0466bee6d601efce77d1a439a8",
  titan:"ea60aa6a868b65b05f1554b89a5db3fa12d50214"
});
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const HOST_HASH_RE = /^[0-9a-f]{16}$/;
const REQUIRED_PAGE_TYPES = 4;
const REQUIRED_OBSERVATIONS = 8;
const REQUIRED_UNIQUE_HOSTS = 6;
const REQUIRED_PER_MODE = 2;

function pushOnce(list, value) {
  if (!list.includes(value)) list.push(value);
}

export function validateWitness(witness, { expectedCommit = "", expectedPackageSha256 = "" } = {}) {
  const blockers = [];
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    return { ok:false, blockers:["witness_not_object"], summary:{} };
  }
  if (witness.schema !== 2) pushOnce(blockers, "schema_not_2");
  if (witness.release_gate_closed !== false) pushOnce(blockers, "release_gate_semantics_invalid");
  if (witness.manual_beta_review_ready !== true) pushOnce(blockers, "manual_beta_review_not_ready");
  if (witness.coverage_review_ready !== true) pushOnce(blockers, "coverage_review_not_ready");

  const candidate = witness.candidate && typeof witness.candidate === "object" ? witness.candidate : {};
  const sourceCommit = String(candidate.source_commit || "").toLowerCase();
  const packageSha256 = String(candidate.package_sha256 || "").toLowerCase();
  if (candidate.bound !== true || !COMMIT_RE.test(sourceCommit) || !SHA256_RE.test(packageSha256)) {
    pushOnce(blockers, "candidate_not_bound");
  }
  if (expectedCommit) {
    const value = String(expectedCommit).toLowerCase();
    if (!COMMIT_RE.test(value) || sourceCommit !== value) pushOnce(blockers, "source_commit_mismatch");
  }
  if (expectedPackageSha256) {
    const value = String(expectedPackageSha256).toLowerCase();
    if (!SHA256_RE.test(value) || packageSha256 !== value) pushOnce(blockers, "package_sha256_mismatch");
  }

  const feed = witness.feed_v2_beta && typeof witness.feed_v2_beta === "object" ? witness.feed_v2_beta : {};
  if (feed.active !== true) pushOnce(blockers, "pinned_v2_not_active");
  if (feed.pinned_ref !== PINNED_REF) pushOnce(blockers, "pinned_ref_mismatch");
  if (feed.validation_ready !== true || Number(feed.validated_feeds) !== 3 || Number(feed.observed_feeds) !== 3) {
    pushOnce(blockers, "pinned_v2_bundle_not_verified");
  }
  const feeds = feed.feeds && typeof feed.feeds === "object" ? feed.feeds : {};
  for (const [kind, expectedBlob] of Object.entries(EXPECTED_BLOBS)) {
    const item = feeds[kind] && typeof feeds[kind] === "object" ? feeds[kind] : null;
    if (!item) {
      pushOnce(blockers, `feed_${kind}_missing`);
      continue;
    }
    if (item.ok !== true || item.verified !== true || item.fresh !== true) pushOnce(blockers, `feed_${kind}_not_fresh_verified`);
    if (item.fallback === true) pushOnce(blockers, `feed_${kind}_fallback_active`);
    if (Number(item.status) !== 200) pushOnce(blockers, `feed_${kind}_status_not_200`);
    if (item.integrity !== "git-blob-sha1") pushOnce(blockers, `feed_${kind}_integrity_invalid`);
    if (String(item.blob_sha1 || "") !== expectedBlob) pushOnce(blockers, `feed_${kind}_blob_mismatch`);
    if (Number(item.failure_count || 0) !== 0 || item.channel_disabled === true) pushOnce(blockers, `feed_${kind}_runtime_unhealthy`);
  }

  const summary = witness.summary && typeof witness.summary === "object" ? witness.summary : {};
  if (Number(summary.observations) < REQUIRED_OBSERVATIONS) pushOnce(blockers, "observations_below_minimum");
  if (Number(summary.unique_hosts) < REQUIRED_UNIQUE_HOSTS) pushOnce(blockers, "unique_hosts_below_minimum");
  if (Number(summary.page_types) < REQUIRED_PAGE_TYPES) pushOnce(blockers, "page_types_below_minimum");
  if (Number(summary.standard) < REQUIRED_PER_MODE || Number(summary.ultra) < REQUIRED_PER_MODE) pushOnce(blockers, "mode_coverage_below_minimum");
  if (Number(summary.content_failures) !== 0) pushOnce(blockers, "content_failures_present");
  if (Number(summary.unrecovered_breakage) !== 0) pushOnce(blockers, "unrecovered_breakage_present");

  const privacy = witness.privacy && typeof witness.privacy === "object" ? witness.privacy : {};
  if (privacy.hostnames !== "sha256-prefix-16" || privacy.urls !== "omitted" || privacy.paths_queries_fragments !== "omitted" || privacy.telemetry !== false) {
    pushOnce(blockers, "privacy_contract_invalid");
  }
  const observations = Array.isArray(witness.observations) ? witness.observations : [];
  if (observations.length !== Number(summary.observations || 0)) pushOnce(blockers, "observation_count_mismatch");
  for (const observation of observations) {
    if (!observation || typeof observation !== "object" || !HOST_HASH_RE.test(String(observation.host_hash || ""))) {
      pushOnce(blockers, "host_hash_invalid");
      break;
    }
    for (const forbidden of ["host", "hostname", "url", "path", "query", "fragment", "page_title", "title"]) {
      if (Object.prototype.hasOwnProperty.call(observation, forbidden)) {
        pushOnce(blockers, "raw_navigation_data_present");
        break;
      }
    }
  }

  return {
    ok:blockers.length === 0,
    blockers,
    summary:{
      source_commit:sourceCommit || "unbound",
      package_sha256_bound:SHA256_RE.test(packageSha256),
      pinned_ref:feed.pinned_ref || "",
      validated_feeds:Number(feed.validated_feeds || 0),
      observations:Number(summary.observations || 0),
      unique_hosts:Number(summary.unique_hosts || 0),
      release_gate_closed:false
    }
  };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--witness=")) out.witness = arg.slice(10);
    else if (arg.startsWith("--expected-commit=")) out.expectedCommit = arg.slice(18);
    else if (arg.startsWith("--expected-package-sha256=")) out.expectedPackageSha256 = arg.slice(26);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return "Usage: node tools/validate-normal-browsing-v2-witness.mjs --witness=beta-review.json [--expected-commit=<40hex>] [--expected-package-sha256=<64hex>]";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.witness) throw new Error("--witness is required");
    const witness = JSON.parse(fs.readFileSync(args.witness, "utf8"));
    const result = validateWitness(witness, {
      expectedCommit:args.expectedCommit || "",
      expectedPackageSha256:args.expectedPackageSha256 || ""
    });
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`ERROR: ${error?.message || error}`);
    console.error(usage());
    process.exit(2);
  }
}
