import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const stagingRoot = resolve(extensionRoot, "packages/feed-v2-staging");
const stagingManifestPath = resolve(stagingRoot, "staging-manifest.json");
const PARALLEL_PREFIX = "browser-intelligence/v2/";
const suspiciousKeys = new Set([
  "code", "script", "scripts", "javascript", "js", "wasm", "executable",
  "eval", "function", "module", "import", "imports", "remote_code"
]);

function fail(message) {
  throw new Error(`feed_v2_parallel_endpoints: ${message}`);
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

function safeRepoPath(relativePath) {
  if (!relativePath.startsWith(PARALLEL_PREFIX)
      || relativePath.includes("..")
      || relativePath.includes("\\")
      || relativePath.startsWith("/")) {
    fail(`unsafe parallel endpoint path: ${relativePath}`);
  }
  const absolute = resolve(repoRoot, relativePath);
  const rootPrefix = `${resolve(repoRoot, "browser-intelligence/v2")}${sep}`;
  if (!absolute.startsWith(rootPrefix)) fail(`parallel endpoint escaped repository v2 root: ${relativePath}`);
  return absolute;
}

export function validateEndpointPair({ id, metadata, stagedText, committedText }) {
  const expectedDigest = String(metadata?.candidate_sha256 || "");
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) fail(`${id}: invalid expected SHA-256`);

  const stagedDigest = sha256(stagedText);
  const committedDigest = sha256(committedText);
  if (stagedDigest !== expectedDigest) fail(`${id}: regenerated staging SHA-256 mismatch`);
  if (committedDigest !== expectedDigest) fail(`${id}: committed endpoint SHA-256 mismatch`);
  if (committedText !== stagedText) fail(`${id}: committed endpoint bytes differ from regenerated candidate`);

  let feed;
  try {
    feed = JSON.parse(committedText);
  } catch {
    fail(`${id}: committed endpoint is not valid JSON`);
  }
  if (feed.schema !== 2) fail(`${id}: committed endpoint must use schema v2`);
  if (feed.feed_version !== metadata.candidate_version) fail(`${id}: feed_version mismatch`);
  if (feed.expires_at !== metadata.candidate_expires_at) fail(`${id}: expires_at mismatch`);
  if (feed.rollback?.previous_version !== metadata.rollback_previous_version
      || feed.rollback?.previous_ref !== metadata.rollback_previous_ref) {
    fail(`${id}: rollback metadata mismatch`);
  }
  assertDataOnly(feed);
  return { digest: committedDigest, feed };
}

async function main() {
  const manifest = JSON.parse(await readFile(stagingManifestPath, "utf8"));
  if (manifest?.schema !== 1 || !Array.isArray(manifest.files)) fail("invalid staging manifest");
  if (manifest.publication_authorized !== false || manifest.remote_executable_code !== false) {
    fail("staging safety flags drifted");
  }
  if (manifest.target_ref !== "chrome-v150-adaptive-memory") fail("unexpected parallel-v2 target ref");
  if (manifest.files.length !== 3) fail(`expected three parallel endpoints; got ${manifest.files.length}`);

  const seen = new Set();
  const verified = [];
  for (const metadata of manifest.files) {
    const id = String(metadata.id || "").trim();
    const targetPath = String(metadata.target_path || "").trim();
    if (!id || seen.has(id)) fail(`duplicate/empty feed id: ${id || "<empty>"}`);
    seen.add(id);
    if (metadata.target_ref !== manifest.target_ref) fail(`${id}: target_ref differs from manifest`);

    const committedPath = safeRepoPath(targetPath);
    const stagedPath = resolve(stagingRoot, targetPath);
    const [stagedText, committedText] = await Promise.all([
      readFile(stagedPath, "utf8"),
      readFile(committedPath, "utf8"),
    ]);
    const result = validateEndpointPair({ id, metadata, stagedText, committedText });
    verified.push(`${id}@${result.digest.slice(0, 12)}`);
  }

  console.log(`Committed parallel-v2 endpoints: PASS (${verified.join(", ")}); production-v1 paths untouched`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
