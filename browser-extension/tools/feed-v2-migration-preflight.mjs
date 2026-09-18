import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const checksumsPath = resolve(repoRoot, "browser-intelligence/feed-checksums.json");
const planPath = resolve(repoRoot, "browser-intelligence/feed-v2-migration-plan.json");
const outputDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const shouldWrite = process.argv.includes("--write");

const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_FEED_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_V2_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;
const suspiciousKeys = new Set([
  "code", "script", "scripts", "javascript", "js", "wasm", "executable",
  "eval", "function", "module", "import", "imports", "remote_code"
]);

function fail(message) {
  throw new Error(`feed_v2_migration_preflight: ${message}`);
}

function parseTimestamp(value, label) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) fail(`${label} is not a valid timestamp`);
  return ms;
}

function gitBlobSha1(text) {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
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

function validateTargetMetadata(target, production, pinned, now) {
  if (!target || typeof target !== "object") fail(`${pinned.id}: missing migration plan entry`);
  const version = String(target.target_version || "").trim();
  if (!version || version === String(production.feed_version || "")) fail(`${pinned.id}: target version must differ from production`);

  const updatedAt = parseTimestamp(target.target_updated_at, `${pinned.id}: target_updated_at`);
  const expiresAt = parseTimestamp(target.target_expires_at, `${pinned.id}: target_expires_at`);
  if (updatedAt > now + MAX_FUTURE_SKEW_MS) fail(`${pinned.id}: target_updated_at too far in future`);
  if (now - updatedAt > MAX_FEED_AGE_MS) fail(`${pinned.id}: migration plan is stale and must be regenerated`);
  if (expiresAt <= now) fail(`${pinned.id}: target candidate already expired`);
  if (expiresAt <= updatedAt) fail(`${pinned.id}: expires_at must be after updated_at`);
  if (expiresAt - updatedAt > MAX_V2_LIFETIME_MS) fail(`${pinned.id}: expiry window exceeds 60 days`);

  return { version, updatedAt: target.target_updated_at, expiresAt: target.target_expires_at };
}

async function fetchPinnedProduction(pinned) {
  const url = `https://raw.githubusercontent.com/Swir/xADKiller/${encodeURIComponent(pinned.source_ref)}/${pinned.path}`;
  const response = await fetch(url, { headers: { "User-Agent": "xADKiller-feed-v2-preflight" } });
  if (!response.ok) fail(`${pinned.id}: production fetch returned HTTP ${response.status}`);
  const text = await response.text();
  const actualBlob = gitBlobSha1(text);
  if (actualBlob !== pinned.git_blob_sha1) {
    fail(`${pinned.id}: pinned production blob changed (${actualBlob} != ${pinned.git_blob_sha1})`);
  }
  let json;
  try { json = JSON.parse(text); } catch { fail(`${pinned.id}: production payload is not valid JSON`); }
  if (json.schema !== 1) fail(`${pinned.id}: production source is no longer schema v1; update the migration gate`);
  if (json.feed_version !== pinned.feed_version) fail(`${pinned.id}: production version mismatch`);
  if (json.updated_at !== pinned.updated_at) fail(`${pinned.id}: production timestamp mismatch`);
  assertDataOnly(json);
  return json;
}

async function main() {
  const checksums = JSON.parse(await readFile(checksumsPath, "utf8"));
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (checksums?.schema !== 1 || !Array.isArray(checksums.feeds)) fail("invalid feed-checksums.json");
  if (plan?.schema !== 1 || !Array.isArray(plan.feeds)) fail("invalid feed-v2-migration-plan.json");

  const planById = new Map(plan.feeds.map((entry) => [entry.id, entry]));
  if (planById.size !== checksums.feeds.length) fail("migration plan must cover every pinned production feed exactly once");
  const now = Date.now();
  const results = [];

  for (const pinned of checksums.feeds) {
    const production = await fetchPinnedProduction(pinned);
    const metadata = validateTargetMetadata(planById.get(pinned.id), production, pinned, now);
    const previousRef = `${pinned.source_ref}/${pinned.path}`;
    if (previousRef.includes("..") || previousRef.startsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(previousRef)) {
      fail(`${pinned.id}: generated rollback reference is unsafe`);
    }

    const candidate = {
      ...production,
      schema: 2,
      feed_version: metadata.version,
      updated_at: metadata.updatedAt,
      expires_at: metadata.expiresAt,
      rollback: {
        previous_version: production.feed_version,
        previous_ref: previousRef
      }
    };

    assertDataOnly(candidate);
    if (JSON.stringify(payloadOnly(candidate)) !== JSON.stringify(payloadOnly(production))) {
      fail(`${pinned.id}: v2 conversion changed protection data`);
    }
    if (candidate.rollback.previous_version !== production.feed_version) fail(`${pinned.id}: rollback version mismatch`);
    if (candidate.rollback.previous_ref !== previousRef) fail(`${pinned.id}: rollback ref mismatch`);

    if (shouldWrite) {
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, `${pinned.id}.json`), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    }
    results.push(`${pinned.id}:${production.feed_version}->${candidate.feed_version}`);
  }

  const extraPlanIds = [...planById.keys()].filter((id) => !checksums.feeds.some((feed) => feed.id === id));
  if (extraPlanIds.length) fail(`unknown migration plan feed ids: ${extraPlanIds.join(",")}`);

  console.log(`Feed v2 migration preflight OK (${results.join(", ")})${shouldWrite ? `; candidates written to ${outputDir}` : ""}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
