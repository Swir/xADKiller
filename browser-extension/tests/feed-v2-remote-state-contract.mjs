import assert from "node:assert/strict";
import { buildPinnedUrl } from "../tools/feed-v2-network-contract.mjs";
import { gitBlobSha1, sha256, validateRolloutEnvelope, verifyRemoteEntry } from "../tools/verify-feed-v2-remote-state.mjs";

function responseFor(text, descriptor) {
  const body = new Response(text).body;
  return {
    status: 200,
    ok: true,
    redirected: false,
    url: buildPinnedUrl(descriptor),
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text, "utf8"))
    }),
    body
  };
}

function fetchFor(text, descriptor) {
  return async (url, options) => {
    assert.equal(url, buildPinnedUrl(descriptor));
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return responseFor(text, descriptor);
  };
}

async function rejects(promise, pattern) {
  let error;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, "expected verification to reject");
  assert.match(String(error.message || error), pattern);
}

const descriptor = { id: "live-shield", source_ref: "live-shield-feed-v1", path: "browser-intelligence/xadkiller-live-shield.json" };
const preText = `${JSON.stringify({ schema: 1, feed_version: "2026.09.18-v1", updated_at: "2026-09-18T12:00:00Z", domains: ["ads.example"] }, null, 2)}\n`;
const postJson = {
  schema: 2,
  feed_version: "2026.09.18-v2",
  updated_at: "2026-09-18T12:00:00Z",
  expires_at: "2026-10-18T12:00:00Z",
  rollback: {
    previous_version: "2026.09.18-v1",
    previous_ref: `${descriptor.source_ref}/${descriptor.path}`
  },
  domains: ["ads.example"]
};
const postText = `${JSON.stringify(postJson, null, 2)}\n`;

const entry = {
  id: descriptor.id,
  target_ref: descriptor.source_ref,
  target_path: descriptor.path,
  expected_current_git_blob_sha1: gitBlobSha1(preText),
  expected_current_version: "2026.09.18-v1",
  candidate_version: postJson.feed_version,
  rollback: {
    previous_version: postJson.rollback.previous_version,
    previous_ref: postJson.rollback.previous_ref,
    previous_git_blob_sha1: gitBlobSha1(preText)
  },
  post_publish_verify: {
    schema: 2,
    feed_version: postJson.feed_version,
    git_blob_sha1: gitBlobSha1(postText),
    sha256: sha256(postText)
  }
};

validateRolloutEnvelope({ schema: 1, publication_authorized: false, remote_executable_code: false, feeds: [entry] });
assert.equal((await verifyRemoteEntry(entry, "pre", fetchFor(preText, descriptor))).schema, 1);
assert.equal((await verifyRemoteEntry(entry, "post", fetchFor(postText, descriptor))).schema, 2);

await rejects(
  verifyRemoteEntry({ ...entry, expected_current_git_blob_sha1: "0".repeat(40) }, "pre", fetchFor(preText, descriptor)),
  /optimistic-concurrency blob changed/
);
await rejects(
  verifyRemoteEntry({ ...entry, post_publish_verify: { ...entry.post_publish_verify, sha256: "0".repeat(64) } }, "post", fetchFor(postText, descriptor)),
  /payload fingerprint mismatch/
);
const badRollbackText = `${JSON.stringify({ ...postJson, rollback: { ...postJson.rollback, previous_version: "wrong" } }, null, 2)}\n`;
await rejects(
  verifyRemoteEntry({ ...entry, post_publish_verify: { ...entry.post_publish_verify, git_blob_sha1: gitBlobSha1(badRollbackText), sha256: sha256(badRollbackText) } }, "post", fetchFor(badRollbackText, descriptor)),
  /rollback metadata mismatch/
);
assert.throws(
  () => validateRolloutEnvelope({ schema: 1, publication_authorized: true, remote_executable_code: false, feeds: [entry] }),
  /explicitly unauthorized/
);

console.log("Feed v2 remote-state contract OK (pre/post fingerprints, rollback metadata, unauthorized envelope)");
