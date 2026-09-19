import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const candidateDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const candidateManifestPath = resolve(candidateDir, "manifest.json");
const checksumsPath = resolve(repoRoot, "browser-intelligence/feed-checksums.json");
const migrationPlanPath = resolve(repoRoot, "browser-intelligence/feed-v2-migration-plan.json");
const outputPath = resolve(candidateDir, "rollout-plan.json");

const MIN_PUBLICATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(`feed_v2_rollout_plan: ${message}`);
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

function assertSafeTarget(ref, path, id) {
  if (!/^[A-Za-z0-9._-]+$/.test(ref) || ref === "." || ref === "..") {
    fail(`${id}: unsafe publication ref`);
  }
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    fail(`${id}: unsafe publication path`);
  }
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    fail(`${id}: unsafe publication path`);
  }
}

async function main() {
  const [candidateManifest, checksums, migrationPlan] = await Promise.all([
    readFile(candidateManifestPath, "utf8").then(JSON.parse),
    readFile(checksumsPath, "utf8").then(JSON.parse),
    readFile(migrationPlanPath, "utf8").then(JSON.parse)
  ]);

  if (candidateManifest?.schema !== 1 || !Array.isArray(candidateManifest.feeds)) {
    fail("invalid candidate manifest");
  }
  if (checksums?.schema !== 1 || !Array.isArray(checksums.feeds)) {
    fail("invalid production checksum ledger");
  }
  if (migrationPlan?.schema !== 1 || !Array.isArray(migrationPlan.feeds)) {
    fail("invalid migration plan");
  }

  const candidateById = new Map(candidateManifest.feeds.map((entry) => [entry.id, entry]));
  const targetById = new Map(migrationPlan.feeds.map((entry) => [entry.id, entry]));
  if (candidateById.size !== candidateManifest.feeds.length || targetById.size !== migrationPlan.feeds.length) {
    fail("duplicate feed id in candidate manifest or migration plan");
  }
  if (candidateManifest.feeds.length !== checksums.feeds.length || targetById.size !== checksums.feeds.length) {
    fail("rollout plan must cover every pinned production feed exactly once");
  }

  const now = Date.now();
  const feeds = [];
  for (const pinned of checksums.feeds) {
    const id = String(pinned?.id || "").trim();
    const candidateEntry = candidateById.get(id);
    const target = targetById.get(id);
    if (!id || !candidateEntry || !target) fail(`${id || "<empty>"}: missing candidate or target entry`);

    const targetRef = String(pinned.source_ref || "");
    const targetPath = String(pinned.path || "");
    assertSafeTarget(targetRef, targetPath, id);

    if (candidateEntry.source_ref !== targetRef || candidateEntry.source_path !== targetPath) {
      fail(`${id}: candidate provenance differs from production target`);
    }
    if (candidateEntry.source_git_blob_sha1 !== pinned.git_blob_sha1) {
      fail(`${id}: candidate expected-current blob differs from production ledger`);
    }
    if (candidateEntry.candidate_version !== target.target_version
        || candidateEntry.candidate_expires_at !== target.target_expires_at) {
      fail(`${id}: candidate metadata differs from migration plan`);
    }

    const candidateFile = String(candidateEntry.candidate_file || "");
    if (candidateFile !== `${id}.json`) fail(`${id}: unexpected candidate filename`);
    const candidateText = await readFile(resolve(candidateDir, candidateFile), "utf8");
    if (sha256(candidateText) !== candidateEntry.candidate_sha256) {
      fail(`${id}: candidate SHA-256 mismatch before rollout rehearsal`);
    }
    let candidate;
    try { candidate = JSON.parse(candidateText); } catch { fail(`${id}: candidate JSON invalid`); }
    if (candidate?.schema !== 2 || candidate.feed_version !== target.target_version) {
      fail(`${id}: candidate is not the planned schema-v2 version`);
    }
    const expiresMs = Date.parse(candidate.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs - now < MIN_PUBLICATION_VALIDITY_MS) {
      fail(`${id}: candidate has less than 7 days of validity left; regenerate migration metadata`);
    }
    if (candidate.rollback?.previous_version !== pinned.feed_version
        || candidate.rollback?.previous_ref !== `${targetRef}/${targetPath}`) {
      fail(`${id}: candidate rollback metadata does not match current production source`);
    }

    const candidateBlobSha1 = gitBlobSha1(candidateText);
    feeds.push({
      id,
      target_ref: targetRef,
      target_path: targetPath,
      expected_current_git_blob_sha1: pinned.git_blob_sha1,
      expected_current_version: pinned.feed_version,
      candidate_file: candidateFile,
      candidate_version: candidate.feed_version,
      candidate_expires_at: candidate.expires_at,
      candidate_sha256: candidateEntry.candidate_sha256,
      candidate_git_blob_sha1: candidateBlobSha1,
      rollback: {
        previous_version: pinned.feed_version,
        previous_ref: `${targetRef}/${targetPath}`,
        previous_git_blob_sha1: pinned.git_blob_sha1
      },
      post_publish_verify: {
        schema: 2,
        feed_version: candidate.feed_version,
        git_blob_sha1: candidateBlobSha1,
        sha256: candidateEntry.candidate_sha256
      }
    });
  }

  const rollout = {
    schema: 1,
    purpose: "Development-only feed-v2 publication rehearsal. This file authorizes no remote write; it pins the exact optimistic-concurrency precondition, candidate blob and immutable rollback blob for a future reviewed data-only rollout.",
    publication_authorized: false,
    remote_executable_code: false,
    source_candidate_manifest: "browser-extension/packages/feed-v2-candidates/manifest.json",
    source_checksums: "browser-intelligence/feed-checksums.json",
    source_migration_plan: "browser-intelligence/feed-v2-migration-plan.json",
    minimum_remaining_validity_days: 7,
    feeds
  };

  await writeFile(outputPath, `${JSON.stringify(rollout, null, 2)}\n`, "utf8");
  console.log(`Feed v2 rollout rehearsal plan OK (${feeds.map((feed) => `${feed.id}:${feed.expected_current_git_blob_sha1.slice(0, 10)}->${feed.candidate_git_blob_sha1.slice(0, 10)}`).join(", ")}); publication_authorized=false`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
