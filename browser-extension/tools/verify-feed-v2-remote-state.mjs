import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchPinnedJson } from "./feed-v2-network-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const rolloutPath = resolve(extensionRoot, "packages/feed-v2-candidates/rollout-plan.json");
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SAFE_REF_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function fail(message) {
  throw new Error(`feed_v2_remote_state: ${message}`);
}

export function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function gitBlobSha1(text) {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

function requireSafeTarget(ref, path, id) {
  if (!SAFE_REF_RE.test(ref) || ref === "." || ref === "..") fail(`${id}: unsafe target ref`);
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    fail(`${id}: unsafe target path`);
  }
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || !SAFE_SEGMENT_RE.test(part))) {
    fail(`${id}: unsafe target path`);
  }
}

function requireEntry(entry) {
  const id = String(entry?.id || "").trim();
  const targetRef = String(entry?.target_ref || "").trim();
  const targetPath = String(entry?.target_path || "").trim();
  if (!id || !targetRef || !targetPath) fail("rollout entry is missing target identity");
  requireSafeTarget(targetRef, targetPath, id);
  return { id, targetRef, targetPath };
}

function requireHash(value, pattern, label, id) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!pattern.test(normalized)) fail(`${id}: invalid ${label}`);
  return normalized;
}

function requireVersion(value, label, id) {
  const version = String(value || "").trim();
  if (!version || version.length > 160 || /[\u0000-\u001f\u007f]/.test(version)) fail(`${id}: invalid ${label}`);
  return version;
}

export function validateRolloutEntry(entry, seenIds = new Set(), seenTargets = new Set()) {
  const { id, targetRef, targetPath } = requireEntry(entry);
  const targetKey = `${targetRef}\n${targetPath}`;
  if (seenIds.has(id)) fail(`${id}: duplicate feed id`);
  if (seenTargets.has(targetKey)) fail(`${id}: duplicate publication target`);
  seenIds.add(id);
  seenTargets.add(targetKey);

  const expectedBlob = requireHash(entry.expected_current_git_blob_sha1, SHA1_RE, "expected-current Git blob SHA-1", id);
  const expectedVersion = requireVersion(entry.expected_current_version, "expected-current version", id);
  const candidateVersion = requireVersion(entry.candidate_version, "candidate version", id);
  if (candidateVersion === expectedVersion) fail(`${id}: candidate version must differ from current production version`);

  const rollback = entry.rollback || {};
  if (rollback.previous_version !== expectedVersion) fail(`${id}: rollback previous_version must equal expected-current version`);
  if (rollback.previous_ref !== `${targetRef}/${targetPath}`) fail(`${id}: rollback previous_ref must pin the current publication target`);
  if (requireHash(rollback.previous_git_blob_sha1, SHA1_RE, "rollback Git blob SHA-1", id) !== expectedBlob) {
    fail(`${id}: rollback Git blob SHA-1 must equal expected-current blob`);
  }

  const post = entry.post_publish_verify || {};
  if (post.schema !== 2) fail(`${id}: post-publication schema must be 2`);
  if (post.feed_version !== candidateVersion) fail(`${id}: post-publication version must equal candidate version`);
  const postBlob = requireHash(post.git_blob_sha1, SHA1_RE, "post-publication Git blob SHA-1", id);
  const postSha256 = requireHash(post.sha256, SHA256_RE, "post-publication SHA-256", id);

  if (entry.candidate_git_blob_sha1 !== undefined
      && requireHash(entry.candidate_git_blob_sha1, SHA1_RE, "candidate Git blob SHA-1", id) !== postBlob) {
    fail(`${id}: candidate Git blob SHA-1 differs from post-publication fingerprint`);
  }
  if (entry.candidate_sha256 !== undefined
      && requireHash(entry.candidate_sha256, SHA256_RE, "candidate SHA-256", id) !== postSha256) {
    fail(`${id}: candidate SHA-256 differs from post-publication fingerprint`);
  }

  return { id, targetRef, targetPath, expectedBlob, expectedVersion, candidateVersion, postBlob, postSha256 };
}

export async function verifyRemoteEntry(entry, mode = "pre", fetchImpl = globalThis.fetch) {
  const { id, targetRef, targetPath } = requireEntry(entry);
  if (mode !== "pre" && mode !== "post") fail(`unsupported mode: ${mode}`);

  const fetched = await fetchPinnedJson({ id, source_ref: targetRef, path: targetPath }, fetchImpl);
  const blob = gitBlobSha1(fetched.text);
  const digest = sha256(fetched.text);
  const json = fetched.json;

  if (mode === "pre") {
    if (json?.schema !== 1) fail(`${id}: pre-publication target is no longer schema v1`);
    if (json?.feed_version !== entry.expected_current_version) {
      fail(`${id}: pre-publication version changed (${json?.feed_version || "<missing>"})`);
    }
    if (blob !== entry.expected_current_git_blob_sha1) {
      fail(`${id}: optimistic-concurrency blob changed (${blob} != ${entry.expected_current_git_blob_sha1})`);
    }
    return { id, mode, schema: 1, feedVersion: json.feed_version, gitBlobSha1: blob, sha256: digest };
  }

  const expected = entry.post_publish_verify || {};
  if (json?.schema !== expected.schema || json?.feed_version !== expected.feed_version) {
    fail(`${id}: post-publication schema/version mismatch`);
  }
  if (blob !== expected.git_blob_sha1 || digest !== expected.sha256) {
    fail(`${id}: post-publication payload fingerprint mismatch`);
  }
  if (json?.rollback?.previous_version !== entry.rollback?.previous_version
      || json?.rollback?.previous_ref !== entry.rollback?.previous_ref) {
    fail(`${id}: post-publication rollback metadata mismatch`);
  }
  return { id, mode, schema: json.schema, feedVersion: json.feed_version, gitBlobSha1: blob, sha256: digest };
}

export function validateRolloutEnvelope(rollout) {
  if (rollout?.schema !== 1 || rollout.publication_authorized !== false
      || rollout.remote_executable_code !== false || !Array.isArray(rollout.feeds) || !rollout.feeds.length) {
    fail("rollout plan must remain non-empty, development-only, data-only and explicitly unauthorized");
  }
  const seenIds = new Set();
  const seenTargets = new Set();
  for (const entry of rollout.feeds) validateRolloutEntry(entry, seenIds, seenTargets);
  return rollout;
}

function parseMode(argv) {
  const arg = argv.find((value) => value.startsWith("--mode="));
  const mode = arg ? arg.slice("--mode=".length) : "pre";
  if (mode !== "pre" && mode !== "post") fail(`unsupported mode: ${mode}`);
  return mode;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const rollout = validateRolloutEnvelope(JSON.parse(await readFile(rolloutPath, "utf8")));
  const results = [];
  for (const entry of rollout.feeds) results.push(await verifyRemoteEntry(entry, mode));
  console.log(`Feed v2 remote ${mode}-publication verification OK (${results.map((item) => `${item.id}:${item.gitBlobSha1.slice(0, 12)}`).join(", ")}); no remote write performed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
