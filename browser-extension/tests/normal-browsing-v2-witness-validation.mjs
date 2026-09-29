import assert from "node:assert/strict";
import { EXPECTED_BLOBS, PINNED_REF, validateWitness } from "../tools/validate-normal-browsing-v2-witness.mjs";

const COMMIT = "b".repeat(40);
const PACKAGE = "a".repeat(64);

function observation(index, mode = index % 2 ? "standard" : "ultra") {
  return {
    host_hash:index.toString(16).padStart(16, "0"),
    mode,
    page_type:["news", "video", "shop", "login"][index % 4],
    expected_content_ok:true,
    blocking_observed:true,
    breakage:false,
    recovery:"none",
    recorded_at:"2026-09-20T10:00:00.000Z"
  };
}

function validWitness() {
  const observations = Array.from({ length:8 }, (_, i) => observation(i + 1));
  const feeds = {};
  for (const [kind, blob] of Object.entries(EXPECTED_BLOBS)) {
    feeds[kind] = {
      ok:true,
      fallback:false,
      status:200,
      checked_at:1_800_000,
      integrity:"git-blob-sha1",
      blob_sha1:blob,
      failure_count:0,
      channel_disabled:false,
      fresh:true,
      verified:true,
      error:""
    };
  }
  return {
    schema:2,
    generated_at:"2026-09-20T10:00:00.000Z",
    scope:"xADKiller Chrome v1.5 normal-browsing local beta review",
    privacy:{ hostnames:"sha256-prefix-16", urls:"omitted", paths_queries_fragments:"omitted", page_titles:"omitted", telemetry:false, package_bytes:"hashed-in-memory-not-stored" },
    candidate:{ extension_version:"1.5.0", source_commit:COMMIT, package_sha256:PACKAGE, bound:true },
    feed_v2_beta:{ active:true, pinned_ref:PINNED_REF, observed_feeds:3, validated_feeds:3, validation_ready:true, feeds },
    coverage_review_ready:true,
    manual_beta_review_ready:true,
    release_gate_closed:false,
    summary:{ observations:8, unique_hosts:8, page_types:4, standard:4, ultra:4, content_failures:0, blocking_observed:8, breakage:0, unrecovered_breakage:0 },
    observations
  };
}

{
  const result = validateWitness(validWitness(), { expectedCommit:COMMIT, expectedPackageSha256:PACKAGE });
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.summary.validated_feeds, 3);
}

{
  const witness = validWitness();
  witness.feed_v2_beta.feeds["live-matrix"].blob_sha1 = "0".repeat(40);
  const result = validateWitness(witness);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("feed_live-matrix_blob_mismatch"));
}

{
  const witness = validWitness();
  witness.feed_v2_beta.feeds.titan.fallback = true;
  const result = validateWitness(witness);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("feed_titan_fallback_active"));
}

{
  const witness = validWitness();
  witness.summary.unrecovered_breakage = 1;
  const result = validateWitness(witness);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("unrecovered_breakage_present"));
}

{
  const witness = validWitness();
  witness.observations[0].url = "https://example.com/private/path?q=1";
  const result = validateWitness(witness);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("raw_navigation_data_present"));
}

{
  const result = validateWitness(validWitness(), { expectedCommit:"c".repeat(40), expectedPackageSha256:"d".repeat(64) });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("source_commit_mismatch"));
  assert.ok(result.blockers.includes("package_sha256_mismatch"));
}

{
  const witness = validWitness();
  witness.release_gate_closed = true;
  const result = validateWitness(witness);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("release_gate_semantics_invalid"));
}

console.log("Chrome normal-browsing pinned-v2 witness validation: PASS");
