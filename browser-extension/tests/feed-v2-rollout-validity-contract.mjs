import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const candidateDir = resolve(extensionRoot, "packages/feed-v2-candidates");
const MIN_PUBLICATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(`feed_v2_rollout_validity_contract: ${message}`);
}

async function main() {
  const [rollout, manifest] = await Promise.all([
    readFile(resolve(candidateDir, "rollout-plan.json"), "utf8").then(JSON.parse),
    readFile(resolve(candidateDir, "manifest.json"), "utf8").then(JSON.parse)
  ]);

  if (!Array.isArray(rollout?.feeds) || !Array.isArray(manifest?.feeds)) {
    fail("rollout or manifest feeds missing");
  }
  const manifestById = new Map(manifest.feeds.map((entry) => [entry.id, entry]));
  const now = Date.now();
  for (const entry of rollout.feeds) {
    const source = manifestById.get(entry.id);
    if (!source) fail(`${entry.id}: manifest entry missing`);
    if (entry.candidate_expires_at !== source.candidate_expires_at) {
      fail(`${entry.id}: expiry drift between rollout and candidate manifest`);
    }
    const expiresMs = Date.parse(String(entry.candidate_expires_at || ""));
    if (!Number.isFinite(expiresMs)) fail(`${entry.id}: invalid candidate expiry`);
    if (expiresMs - now < MIN_PUBLICATION_VALIDITY_MS) {
      fail(`${entry.id}: candidate has less than 7 days of publication validity remaining`);
    }
  }
  console.log(`Feed v2 rollout validity contract OK (${rollout.feeds.length} feeds, >=7 days remaining)`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
