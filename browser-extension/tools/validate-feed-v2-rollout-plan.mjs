import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const candidateDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const rolloutPath = resolve(candidateDir, "rollout-plan.json");
const manifestPath = resolve(candidateDir, "manifest.json");
const checksumsPath = resolve(repoRoot, "browser-intelligence/feed-checksums.json");

function fail(message) {
  throw new Error(`feed_v2_rollout_plan_validate: ${message}`);
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function gitBlobSha1(text) {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

async function main() {
  const [rollout, manifest, checksums] = await Promise.all([
    readFile(rolloutPath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(checksumsPath, "utf8").then(JSON.parse)
  ]);

  if (rollout?.schema !== 1 || rollout.publication_authorized !== false
      || rollout.remote_executable_code !== false || !Array.isArray(rollout.feeds)) {
    fail("rollout plan must be development-only, data-only and explicitly unauthorized");
  }
  if (rollout.minimum_remaining_validity_days !== 7) fail("unexpected minimum validity policy");
  if (manifest?.schema !== 1 || !Array.isArray(manifest.feeds)) fail("invalid candidate manifest");
  if (checksums?.schema !== 1 || !Array.isArray(checksums.feeds)) fail("invalid checksum ledger");
  if (rollout.feeds.length !== checksums.feeds.length) fail("rollout plan feed count mismatch");

  const manifestById = new Map(manifest.feeds.map((entry) => [entry.id, entry]));
  const checksumById = new Map(checksums.feeds.map((entry) => [entry.id, entry]));
  if (manifestById.size !== manifest.feeds.length || checksumById.size !== checksums.feeds.length) {
    fail("duplicate feed id in source ledgers");
  }

  const seen = new Set();
  for (const entry of rollout.feeds) {
    const id = String(entry?.id || "");
    if (!id || seen.has(id)) fail(`duplicate or empty rollout feed id: ${id || "<empty>"}`);
    seen.add(id);
    const pinned = checksumById.get(id);
    const candidateEntry = manifestById.get(id);
    if (!pinned || !candidateEntry) fail(`${id}: missing pinned/candidate source`);

    if (entry.target_ref !== pinned.source_ref || entry.target_path !== pinned.path) {
      fail(`${id}: rollout target drifted from pinned production source`);
    }
    if (entry.expected_current_git_blob_sha1 !== pinned.git_blob_sha1
        || entry.expected_current_version !== pinned.feed_version) {
      fail(`${id}: optimistic-concurrency precondition mismatch`);
    }
    if (entry.candidate_file !== candidateEntry.candidate_file
        || entry.candidate_version !== candidateEntry.candidate_version
        || entry.candidate_sha256 !== candidateEntry.candidate_sha256) {
      fail(`${id}: rollout candidate metadata mismatch`);
    }
    if (entry.rollback?.previous_version !== pinned.feed_version
        || entry.rollback?.previous_ref !== `${pinned.source_ref}/${pinned.path}`
        || entry.rollback?.previous_git_blob_sha1 !== pinned.git_blob_sha1) {
      fail(`${id}: immutable rollback anchor mismatch`);
    }

    const candidateText = await readFile(resolve(candidateDir, entry.candidate_file), "utf8");
    const candidateSha256 = sha256(candidateText);
    const candidateBlob = gitBlobSha1(candidateText);
    if (candidateSha256 !== entry.candidate_sha256 || candidateBlob !== entry.candidate_git_blob_sha1) {
      fail(`${id}: candidate content fingerprint mismatch`);
    }
    if (entry.post_publish_verify?.schema !== 2
        || entry.post_publish_verify?.feed_version !== entry.candidate_version
        || entry.post_publish_verify?.git_blob_sha1 !== candidateBlob
        || entry.post_publish_verify?.sha256 !== candidateSha256) {
      fail(`${id}: post-publication verification contract mismatch`);
    }

    let candidate;
    try { candidate = JSON.parse(candidateText); } catch { fail(`${id}: candidate JSON invalid`); }
    if (candidate.schema !== 2 || candidate.feed_version !== entry.candidate_version
        || candidate.expires_at !== entry.candidate_expires_at) {
      fail(`${id}: candidate JSON metadata mismatch`);
    }
    if (candidate.rollback?.previous_version !== entry.rollback.previous_version
        || candidate.rollback?.previous_ref !== entry.rollback.previous_ref) {
      fail(`${id}: candidate rollback metadata mismatch`);
    }
  }

  for (const id of checksumById.keys()) {
    if (!seen.has(id)) fail(`${id}: missing rollout entry`);
  }

  console.log(`Feed v2 rollout rehearsal artifact OK (${rollout.feeds.map((entry) => `${entry.id}:${entry.candidate_git_blob_sha1.slice(0, 12)}`).join(", ")}); no publication performed`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
