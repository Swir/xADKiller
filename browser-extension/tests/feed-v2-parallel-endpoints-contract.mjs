import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateEndpointPair } from "../tools/verify-feed-v2-parallel-endpoints.mjs";

const feed = {
  schema: 2,
  feed: "test",
  feed_version: "2026.09.18.1",
  updated_at: "2026-09-18T01:30:00Z",
  expires_at: "2026-10-18T01:30:00Z",
  rollback: { previous_version: "2026.09.13.1", previous_ref: "main/browser-intelligence/test.json" },
  standard_domains: ["ads.example"]
};
const text = `${JSON.stringify(feed, null, 2)}\n`;
const digest = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const metadata = {
  candidate_sha256: digest,
  candidate_version: feed.feed_version,
  candidate_expires_at: feed.expires_at,
  rollback_previous_version: feed.rollback.previous_version,
  rollback_previous_ref: feed.rollback.previous_ref,
};

assert.equal(validateEndpointPair({ id: "ok", metadata, stagedText: text, committedText: text }).digest, digest);
assert.throws(
  () => validateEndpointPair({ id: "tamper", metadata, stagedText: text, committedText: text.replace("ads.example", "tracker.example") }),
  /committed endpoint SHA-256 mismatch/
);
const executable = `${JSON.stringify({ ...feed, script: "alert(1)" }, null, 2)}\n`;
const executableDigest = createHash("sha256").update(Buffer.from(executable, "utf8")).digest("hex");
assert.throws(
  () => validateEndpointPair({
    id: "remote-code",
    metadata: { ...metadata, candidate_sha256: executableDigest },
    stagedText: executable,
    committedText: executable,
  }),
  /executable-looking key/
);
assert.throws(
  () => validateEndpointPair({ id: "rollback", metadata: { ...metadata, rollback_previous_version: "wrong" }, stagedText: text, committedText: text }),
  /rollback metadata mismatch/
);

console.log("Feed v2 committed parallel endpoint contract: PASS");
