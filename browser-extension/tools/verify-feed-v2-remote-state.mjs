import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchPinnedJson } from "./feed-v2-network-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const rolloutPath = resolve(extensionRoot, "packages/feed-v2-candidates/rollout-plan.json");

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

function requireEntry(entry) {
  const id = String(entry?.id || "").trim();
  const targetRef = String(entry?.target_ref || "").trim();
  const targetPath = String(entry?.target_path || "").trim();
  if (!id || !targetRef || !targetPath) fail("rollout entry is missing target identity");
  return { id, targetRef, targetPath };
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
