import assert from "node:assert/strict";
import { validateParallelTarget } from "../tools/build-feed-v2-parallel-staging.mjs";

const production = {
  source_ref: "main",
  source_path: "browser-intelligence/xadkiller-live-shield.json",
};

const good = {
  parallel_v2_ref: "chrome-v150-adaptive-memory",
  parallel_v2_path: "browser-intelligence/v2/xadkiller-live-shield.json",
};
assert.deepEqual(validateParallelTarget(good, production, "live-matrix"), {
  targetRef: "chrome-v150-adaptive-memory",
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
  /aliases production v1/
);
assert.throws(
  () => validateParallelTarget({ ...good, parallel_v2_ref: "../main" }, production, "ref"),
  /unsafe parallel-v2 ref/
);

console.log("Feed v2 parallel staging target contract: PASS");
