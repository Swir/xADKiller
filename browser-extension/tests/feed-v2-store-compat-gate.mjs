import assert from "node:assert/strict";
import {
  inspectStoreCompatibility,
  validatePublicationSafety
} from "../tools/feed-v2-store-compat-gate.mjs";

const feed = (id, targetRef = "main", targetPath = `browser-intelligence/${id}.json`) => ({
  id,
  publication_mode: "parallel-v2",
  target_ref: targetRef,
  target_path: targetPath,
  candidate_target_ref: "chrome-v150-adaptive-memory",
  candidate_target_path: `browser-intelligence/v2/${id}.json`
});

const basePlan = {
  schema: 1,
  publication_authorized: false,
  remote_executable_code: false,
  feeds: [feed("live-shield", "live-shield-feed"), feed("live-matrix"), feed("titan")]
};

{
  const compat = inspectStoreCompatibility(
    'if (data?.schema !== 1) throw new Error("live_feed_schema");',
    'importScripts("background.js");'
  );
  assert.equal(compat.strict_v1_consumer, true);
  assert.equal(compat.feed_v2_compat_loaded, false);
  assert.equal(compat.accepts_schema_v2, false);
  const report = validatePublicationSafety(basePlan, compat);
  assert.equal(report.in_place_schema_v2_publication_blocked, true);
  assert.equal(report.parallel_v2_staging_ready, true);
  assert.equal(report.required_strategy, "parallel-v2-endpoint-or-store-upgrade");
}

{
  const compat = inspectStoreCompatibility(
    'if (data?.schema !== 1) throw new Error("live_feed_schema");',
    'importScripts("feed-v2-compat.js", "background.js");'
  );
  assert.equal(compat.accepts_schema_v2, true);
  const report = validatePublicationSafety({ ...basePlan, publication_authorized:true }, compat);
  assert.equal(report.in_place_schema_v2_publication_blocked, false);
  assert.equal(report.parallel_v2_staging_ready, true);
}

{
  const compat = inspectStoreCompatibility(
    'if (![1, 2].includes(data?.schema)) throw new Error("schema");',
    'importScripts("background.js");'
  );
  assert.equal(compat.strict_v1_consumer, false);
  assert.equal(compat.accepts_schema_v2, true);
}

{
  const incompatible = inspectStoreCompatibility(
    'if (data.schema !== 1) throw new Error("schema");',
    'importScripts("background.js");'
  );
  assert.throws(
    () => validatePublicationSafety({ ...basePlan, publication_authorized:true }, incompatible),
    /publication authorization is unsafe/
  );
  assert.throws(
    () => validatePublicationSafety(basePlan, incompatible, true),
    /in-place schema-v2 publication is blocked/
  );

  const unsafe = structuredClone(basePlan);
  unsafe.feeds[0].candidate_target_ref = unsafe.feeds[0].target_ref;
  unsafe.feeds[0].candidate_target_path = unsafe.feeds[0].target_path;
  assert.throws(
    () => validatePublicationSafety(unsafe, incompatible),
    /lacks isolated parallel-v2 targets/
  );
}

{
  const compatible = inspectStoreCompatibility(
    'if ([1, 2].includes(data.schema)) console.log(data.schema);',
    'importScripts("feed-v2-compat.js", "background.js");'
  );
  assert.throws(
    () => validatePublicationSafety({ ...basePlan, remote_executable_code:true }, compatible),
    /must remain data-only/
  );
}

console.log("Feed v2 store compatibility + parallel staging gate: PASS");
