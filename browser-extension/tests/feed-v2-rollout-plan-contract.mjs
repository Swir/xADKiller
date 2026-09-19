import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const rolloutPath = resolve(extensionRoot, "packages/feed-v2-candidates/rollout-plan.json");
const validator = resolve(extensionRoot, "tools/validate-feed-v2-rollout-plan.mjs");

function fail(message) {
  throw new Error(`feed_v2_rollout_plan_contract: ${message}`);
}

function runValidator(expectSuccess, label) {
  const result = spawnSync(process.execPath, [validator], {
    cwd: extensionRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (expectSuccess && result.status !== 0) {
    fail(`${label}: validator unexpectedly failed: ${result.stderr || result.stdout}`);
  }
  if (!expectSuccess && result.status === 0) {
    fail(`${label}: validator accepted a tampered rollout plan`);
  }
}

async function withTamper(originalText, mutate, label) {
  const data = JSON.parse(originalText);
  mutate(data);
  await writeFile(rolloutPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    runValidator(false, label);
  } finally {
    await writeFile(rolloutPath, originalText, "utf8");
  }
}

async function main() {
  const originalText = await readFile(rolloutPath, "utf8");
  const original = JSON.parse(originalText);
  if (!Array.isArray(original.feeds) || original.feeds.length < 1) fail("generated rollout plan has no feeds");

  runValidator(true, "baseline");

  await withTamper(originalText, (data) => {
    data.publication_authorized = true;
  }, "authorization flip");

  await withTamper(originalText, (data) => {
    data.feeds[0].rollback.previous_git_blob_sha1 = "0".repeat(40);
  }, "rollback blob drift");

  await withTamper(originalText, (data) => {
    data.feeds[0].target_path = "browser-intelligence/other.json";
  }, "target path drift");

  await withTamper(originalText, (data) => {
    data.feeds[0].post_publish_verify.sha256 = "0".repeat(64);
  }, "post-publish fingerprint drift");

  runValidator(true, "restored baseline");
  console.log("Feed v2 rollout plan contract regression OK (authorization/target/rollback/fingerprint tamper rejected)");
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
