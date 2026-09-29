import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const outputDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const checksumsPath = resolve(repoRoot, "browser-intelligence/feed-checksums.json");
const planPath = resolve(repoRoot, "browser-intelligence/feed-v2-migration-plan.json");

const suspiciousKeys = new Set([
  "code", "script", "scripts", "javascript", "js", "wasm", "executable",
  "eval", "function", "module", "import", "imports", "remote_code"
]);

function fail(message) {
  throw new Error(`feed_v2_candidate_artifacts: ${message}`);
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function assertDataOnly(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDataOnly(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (suspiciousKeys.has(String(key).toLowerCase())) fail(`executable-looking key ${path}.${key}`);
    assertDataOnly(child, `${path}.${key}`);
  }
}

function payloadOnly(feed) {
  const copy = structuredClone(feed);
  delete copy.schema;
  delete copy.feed_version;
  delete copy.updated_at;
  delete copy.expires_at;
  delete copy.rollback;
  return copy;
}

async function main() {
  const [manifest, checksums, plan] = await Promise.all([
    readFile(resolve(outputDir, "manifest.json"), "utf8").then(JSON.parse),
    readFile(checksumsPath, "utf8").then(JSON.parse),
    readFile(planPath, "utf8").then(JSON.parse)
  ]);

  if (manifest?.schema !== 1 || manifest?.algorithm !== "sha256" || !Array.isArray(manifest.feeds)) {
    fail("invalid candidate manifest");
  }
  if (checksums?.schema !== 1 || !Array.isArray(checksums.feeds)) fail("invalid production checksum ledger");
  if (plan?.schema !== 1 || !Array.isArray(plan.feeds)) fail("invalid migration plan");
  if (manifest.feeds.length !== checksums.feeds.length || manifest.feeds.length !== plan.feeds.length) {
    fail("candidate manifest must cover every pinned production feed exactly once");
  }

  const checksumById = new Map(checksums.feeds.map((entry) => [entry.id, entry]));
  const planById = new Map(plan.feeds.map((entry) => [entry.id, entry]));
  if (checksumById.size !== checksums.feeds.length || planById.size !== plan.feeds.length) {
    fail("duplicate feed id in source ledgers");
  }

  const seen = new Set();
  for (const entry of manifest.feeds) {
    const id = String(entry?.id || "");
    if (!id || seen.has(id)) fail(`duplicate or empty manifest feed id: ${id || "<empty>"}`);
    seen.add(id);

    const pinned = checksumById.get(id);
    const target = planById.get(id);
    if (!pinned || !target) fail(`${id}: manifest entry has no pinned source/plan entry`);
    if (entry.candidate_file !== `${id}.json`) fail(`${id}: unsafe or unexpected candidate filename`);
    if (entry.source_ref !== pinned.source_ref || entry.source_path !== pinned.path
        || entry.source_git_blob_sha1 !== pinned.git_blob_sha1 || entry.source_version !== pinned.feed_version) {
      fail(`${id}: source provenance differs from pinned production ledger`);
    }
    if (entry.candidate_version !== target.target_version
        || entry.candidate_updated_at !== target.target_updated_at
        || entry.candidate_expires_at !== target.target_expires_at) {
      fail(`${id}: candidate metadata differs from migration plan`);
    }
    if (entry.rollback_previous_version !== pinned.feed_version
        || entry.rollback_previous_ref !== `${pinned.source_ref}/${pinned.path}`) {
      fail(`${id}: rollback provenance mismatch`);
    }

    const text = await readFile(resolve(outputDir, entry.candidate_file), "utf8");
    if (sha256(text) !== entry.candidate_sha256) fail(`${id}: candidate SHA-256 mismatch`);
    let candidate;
    try { candidate = JSON.parse(text); } catch { fail(`${id}: candidate is not valid JSON`); }
    assertDataOnly(candidate);
    if (candidate.schema !== 2) fail(`${id}: candidate schema is not v2`);
    if (candidate.feed_version !== entry.candidate_version
        || candidate.updated_at !== entry.candidate_updated_at
        || candidate.expires_at !== entry.candidate_expires_at) {
      fail(`${id}: candidate JSON metadata mismatch`);
    }
    if (candidate.rollback?.previous_version !== entry.rollback_previous_version
        || candidate.rollback?.previous_ref !== entry.rollback_previous_ref) {
      fail(`${id}: candidate rollback metadata mismatch`);
    }
    const updatedMs = Date.parse(candidate.updated_at);
    const expiresMs = Date.parse(candidate.expires_at);
    if (!Number.isFinite(updatedMs) || !Number.isFinite(expiresMs) || expiresMs <= updatedMs) {
      fail(`${id}: invalid candidate validity window`);
    }
    if (sha256(JSON.stringify(payloadOnly(candidate))) !== entry.protection_payload_sha256) {
      fail(`${id}: protection payload fingerprint mismatch`);
    }
  }

  for (const id of checksumById.keys()) {
    if (!seen.has(id)) fail(`${id}: missing candidate manifest entry`);
  }

  console.log(`Feed v2 candidate artifacts OK (${manifest.feeds.map((entry) => `${entry.id}:${entry.candidate_sha256.slice(0, 12)}`).join(", ")})`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
