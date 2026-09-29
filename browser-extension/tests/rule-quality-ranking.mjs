import assert from "node:assert/strict";
import {
  agreementKey,
  agreementSummary,
  qualityBoost,
  registerSourceAgreement,
  resourceCoverageScore,
  sourceAgreementCount
} from "../tools/rule-quality.mjs";

function rule(urlFilter, resourceTypes, extra = {}) {
  return {
    action: "block",
    priority: 1,
    condition: { urlFilter, resourceTypes, ...extra }
  };
}

const sharedA = rule("||ads.example^", ["script"], { domainType: "thirdParty" });
const sharedB = rule("||ads.example^", ["script", "xmlhttprequest"], { domainType: "thirdParty" });
const single = rule("||single.example^", ["script"], { domainType: "thirdParty" });

const agreement = new Map();
registerSourceAgreement(agreement, sharedA, "easylist");
registerSourceAgreement(agreement, sharedB, "adguard-base");
registerSourceAgreement(agreement, single, "easylist");

assert.equal(agreementKey(sharedA), agreementKey(sharedB), "resource-type variants should share one agreement signal");
assert.equal(sourceAgreementCount(agreement, sharedA), 2, "cross-source support must be counted once per source");
assert.equal(sourceAgreementCount(agreement, single), 1, "single-source rule must stay single-source");
assert.ok(
  qualityBoost(sharedA, sourceAgreementCount(agreement, sharedA)) > qualityBoost(single, sourceAgreementCount(agreement, single)),
  "cross-source agreement must improve quality ranking"
);
assert.ok(
  resourceCoverageScore(sharedB) > resourceCoverageScore(sharedA),
  "useful resource-type coverage must improve the coverage component"
);

const unsafeBroad = rule("/tracking/pixel", ["script", "xmlhttprequest", "sub_frame", "image", "media", "websocket", "font", "ping", "stylesheet", "other"]);
const constrainedBroad = rule("/tracking/pixel", ["script", "xmlhttprequest", "sub_frame", "image", "media", "websocket"], { domainType: "thirdParty" });
assert.ok(
  resourceCoverageScore(unsafeBroad) < resourceCoverageScore(constrainedBroad),
  "broad unconstrained substring rules must not receive the same coverage bonus as constrained rules"
);

const summary = agreementSummary(agreement);
assert.equal(summary.signals, 2);
assert.equal(summary.multiSourceSignals, 1);
assert.equal(summary.maxSourceAgreement, 2);

console.log(JSON.stringify({
  ok: true,
  sourceAgreement: sourceAgreementCount(agreement, sharedA),
  sharedCoverage: resourceCoverageScore(sharedB),
  singleCoverage: resourceCoverageScore(sharedA),
  summary
}, null, 2));
