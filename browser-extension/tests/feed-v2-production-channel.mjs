import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPinnedJson } from "../tools/feed-v2-network-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..");
const descriptorPath = resolve(repoRoot, "browser-intelligence/feed-v2-production-channel.json");
const SHA1_RE = /^[0-9a-f]{40}$/;
const REF_RE = /^[A-Za-z0-9._-]+$/;
const MIN_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

function gitBlobSha1(text) {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

function assertDataOnly(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDataOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      assert.doesNotMatch(value, /^\s*(?:javascript|data:text\/javascript):/i, `${path}: executable URL is forbidden`);
      assert.doesNotMatch(value, /<script\b/i, `${path}: script markup is forbidden`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.doesNotMatch(key, /^(?:script|code|module|function|eval|wasm)$/i, `${path}.${key}: executable field is forbidden`);
    assertDataOnly(entry, `${path}.${key}`);
  }
}

const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
assert.equal(descriptor.schema, 1);
assert.equal(descriptor.channel, "protection-feed-v2");
assert.equal(descriptor.published_ref, descriptor.channel);
assert.match(descriptor.published_ref, REF_RE);
assert.match(descriptor.published_commit, SHA1_RE);
assert.equal(descriptor.publication_mode, "parallel-data-only-v2");
assert.equal(descriptor.legacy_schema_v1_unchanged, true);
assert.equal(descriptor.remote_executable_code, false);
assert.equal(Array.isArray(descriptor.feeds), true);
assert.equal(descriptor.feeds.length, 3);
assert.deepEqual(descriptor.feeds.map((feed) => feed.id).sort(), ["live-matrix", "live-shield", "titan"]);

const seenPaths = new Set();
const now = Date.now();
for (const feed of descriptor.feeds) {
  assert.match(feed.id, /^[a-z0-9-]+$/);
  assert.match(feed.git_blob_sha1, SHA1_RE);
  assert.ok(Number.isSafeInteger(feed.bytes) && feed.bytes > 0 && feed.bytes <= 2 * 1024 * 1024);
  assert.ok(feed.path.startsWith("browser-intelligence/v2/"));
  assert.equal(seenPaths.has(feed.path), false, `${feed.id}: duplicate production-v2 path`);
  seenPaths.add(feed.path);
  assert.ok(Date.parse(feed.expires_at) - now >= MIN_VALIDITY_MS, `${feed.id}: published v2 payload has less than 7 days validity`);

  const [published, immutable] = await Promise.all([
    fetchPinnedJson({ id:feed.id, source_ref:descriptor.published_ref, path:feed.path }),
    fetchPinnedJson({ id:feed.id, source_ref:descriptor.published_commit, path:feed.path })
  ]);

  assert.equal(published.text, immutable.text, `${feed.id}: named production-v2 channel drifted from published commit`);
  assert.equal(Buffer.byteLength(published.text, "utf8"), feed.bytes, `${feed.id}: byte size drift`);
  assert.equal(gitBlobSha1(published.text), feed.git_blob_sha1, `${feed.id}: Git blob fingerprint drift`);
  assert.equal(published.json.schema, 2, `${feed.id}: production channel must remain schema v2`);
  assert.equal(published.json.feed_version, feed.feed_version, `${feed.id}: feed version drift`);
  assert.equal(published.json.expires_at, feed.expires_at, `${feed.id}: expiry drift`);
  assert.deepEqual(published.json.rollback, feed.rollback, `${feed.id}: rollback metadata drift`);
  assertDataOnly(published.json, `$[${feed.id}]`);
}

console.log(`Feed v2 production channel: PASS (${descriptor.feeds.length}/3 data-only feeds; branch=${descriptor.published_ref}; commit=${descriptor.published_commit.slice(0, 12)}; legacy-v1 unchanged)`);
