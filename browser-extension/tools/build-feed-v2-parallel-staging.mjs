import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const candidateDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const stagingRoot = resolve(extensionRoot, "packages/feed-v2-staging");
const migrationPlanPath = resolve(repoRoot, "browser-intelligence/feed-v2-migration-plan.json");
const candidateManifestPath = resolve(candidateDir, "manifest.json");
const PARALLEL_PREFIX = "browser-intelligence/v2/";

function fail(message) {
  throw new Error(`feed_v2_parallel_staging: ${message}`);
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function validateParallelTarget(target, production, id = "feed") {
  if (!target || typeof target !== "object") fail(`${id}: missing migration target`);
  const targetRef = String(target.parallel_v2_ref || "").trim();
  const targetPath = String(target.parallel_v2_path || "").trim();
  const productionRef = String(production?.source_ref || "").trim();
  const productionPath = String(production?.source_path || "").trim();

  if (!targetRef || !/^[A-Za-z0-9._/-]+$/.test(targetRef) || targetRef.includes("..")) {
    fail(`${id}: unsafe parallel-v2 ref`);
  }
  if (targetRef === productionRef && targetPath === productionPath) {
    fail(`${id}: parallel-v2 path aliases production v1`);
  }
  if (!targetPath.startsWith(PARALLEL_PREFIX)
      || targetPath.includes("..")
      || targetPath.includes("\\")
      || targetPath.startsWith("/")) {
    fail(`${id}: parallel-v2 path escaped ${PARALLEL_PREFIX}`);
  }
  return { targetRef, targetPath };
}

function safeStageDestination(relativePath) {
  const destination = resolve(stagingRoot, relativePath);
  const rootPrefix = `${stagingRoot}${sep}`;
  if (!destination.startsWith(rootPrefix)) fail(`staging path escaped bundle root: ${relativePath}`);
  return destination;
}

async function main() {
  const [plan, manifest] = await Promise.all([
    readFile(migrationPlanPath, "utf8").then(JSON.parse),
    readFile(candidateManifestPath, "utf8").then(JSON.parse),
  ]);
  if (plan?.schema !== 1 || !Array.isArray(plan.feeds)) fail("invalid migration plan");
  if (manifest?.schema !== 1 || !Array.isArray(manifest.feeds)) fail("invalid candidate manifest");

  const planById = new Map(plan.feeds.map((entry) => [entry.id, entry]));
  if (planById.size !== manifest.feeds.length) fail("migration plan/candidate manifest feed count mismatch");

  await rm(stagingRoot, { recursive: true, force: true });
  const stagedFiles = [];
  const targetRefs = new Set();

  for (const entry of manifest.feeds) {
    const id = String(entry.id || "");
    const target = planById.get(id);
    if (!target) fail(`${id}: migration target missing`);
    const { targetRef, targetPath } = validateParallelTarget(target, entry, id);
    targetRefs.add(targetRef);

    const candidateName = String(entry.candidate_file || "");
    if (!/^[A-Za-z0-9._-]+\.json$/.test(candidateName)) fail(`${id}: unsafe candidate filename`);
    const candidateText = await readFile(resolve(candidateDir, candidateName), "utf8");
    const digest = sha256(candidateText);
    if (digest !== entry.candidate_sha256) fail(`${id}: candidate SHA-256 mismatch`);

    const candidate = JSON.parse(candidateText);
    if (candidate.schema !== 2) fail(`${id}: staged candidate must be schema v2`);
    if (candidate.feed_version !== entry.candidate_version) fail(`${id}: staged candidate version mismatch`);
    if (candidate.expires_at !== entry.candidate_expires_at) fail(`${id}: staged candidate expiry mismatch`);
    if (candidate.rollback?.previous_version !== entry.rollback_previous_version
        || candidate.rollback?.previous_ref !== entry.rollback_previous_ref) {
      fail(`${id}: staged candidate rollback metadata mismatch`);
    }

    const destination = safeStageDestination(targetPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, candidateText, "utf8");
    stagedFiles.push({
      id,
      target_ref: targetRef,
      target_path: targetPath,
      candidate_sha256: digest,
      candidate_version: candidate.feed_version,
      candidate_expires_at: candidate.expires_at,
      rollback_previous_version: candidate.rollback.previous_version,
      rollback_previous_ref: candidate.rollback.previous_ref,
    });
  }

  if (targetRefs.size !== 1) fail(`parallel-v2 staging must use one reviewed development ref; got ${[...targetRefs].join(",")}`);

  const bundleManifest = {
    schema: 1,
    purpose: "Artifact-only parallel schema-v2 staging bundle. It performs no remote write, does not alter production schema-v1 paths and does not authorize publication.",
    publication_authorized: false,
    remote_executable_code: false,
    target_ref: [...targetRefs][0],
    source_candidate_manifest: "browser-extension/packages/feed-v2-candidates/manifest.json",
    files: stagedFiles,
  };
  await writeFile(resolve(stagingRoot, "staging-manifest.json"), `${JSON.stringify(bundleManifest, null, 2)}\n`, "utf8");
  console.log(`Feed v2 parallel staging bundle OK (${stagedFiles.map((file) => file.target_path).join(", ")}); publication_authorized=false`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
