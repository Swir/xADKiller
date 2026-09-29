import assert from "node:assert/strict";
import { validateParallelTarget } from "../tools/build-feed-v2-parallel-staging.mjs";

const production = {
  source_ref: "main",
  source_path: "browser-intelligence/xadkiller-live-shield.json",
};
const STAGING_PIN = "0930f563b4a4bfdef67885988485bfa8c7646784";

const good = {
  parallel_v2_ref: STAGING_PIN,
  parallel_v2_path: "browser-intelligence/v2/xadkiller-live-shield.json",
};
assert.deepEqual(validateParallelTarget(good, production, "live-matrix"), {
  targetRef: STAGING_PIN,
  targetPath: "browser-intelligence/v2/xadkiller-live-shield.json",
});

assert.throws(
  () => validateParallelTarget({ ...good, parallel_v2_path: "browser-intelligence/../main.json" }, production, "escape"),
  /escaped/
);
assert.throws(
  () => validateParallelTarget({ ...good, parallel_v2_path: "browser-intelligence/not-v2/feed.json" }, production, "prefix"),
  /escaped/
);
assert.throws(
  () => validateParallelTarget({ parallel_v2_ref: "main", parallel_v2_path: production.source_path }, production, "alias"),
  /immutable 40-hex Git commit/
);
assert.throws(
  () => validateParallelTarget({ ...good, parallel_v2_ref: "chrome-v150-adaptive-memory" }, production, "mutable-branch"),
  /immutable 40-hex Git commit/
);
assert.throws(
  () => validateParallelTarget({ ...good, parallel_v2_ref: "../main" }, production, "ref"),
  /immutable 40-hex Git commit/
);

console.log("Feed v2 parallel staging target contract: PASS (immutable staging commit required)");
