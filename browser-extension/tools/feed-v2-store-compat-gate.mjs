import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const defaultStoreRoot = resolve(extensionRoot, "..");
const PARALLEL_V2_PREFIX = "browser-intelligence/v2/";

function fail(message) {
  throw new Error(`feed_v2_store_compat_gate: ${message}`);
}

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function schemaOneOnly(background) {
  const text = String(background || "");
  return /schema\s*!==\s*1/.test(text) || /schema\s*!=\s*1/.test(text);
}

function importsV2Compat(serviceWorker) {
  return /feed-v2-compat\.js/.test(String(serviceWorker || ""));
}

function hasIsolatedParallelTargets(plan) {
  return Array.isArray(plan?.feeds) && plan.feeds.length > 0 && plan.feeds.every((entry) => {
    const candidateRef = String(entry?.candidate_target_ref || "");
    const candidatePath = String(entry?.candidate_target_path || "");
    return entry?.publication_mode === "parallel-v2"
      && candidateRef.length > 0
      && candidatePath.startsWith(PARALLEL_V2_PREFIX)
      && !(candidateRef === entry.target_ref && candidatePath === entry.target_path);
  });
}

export function inspectStoreCompatibility(background, serviceWorker) {
  const strictV1Consumer = schemaOneOnly(background);
  const compatLoaded = importsV2Compat(serviceWorker);
  const acceptsV2 = compatLoaded || !strictV1Consumer;
  return {
    strict_v1_consumer: strictV1Consumer,
    feed_v2_compat_loaded: compatLoaded,
    accepts_schema_v2: acceptsV2,
    safe_strategy: acceptsV2 ? "reviewed-in-place-or-parallel" : "parallel-v2-endpoint-or-store-upgrade"
  };
}

export function validatePublicationSafety(plan, compatibility, requireCompatible = false) {
  if (!plan || plan.schema !== 1 || !Array.isArray(plan.feeds)) fail("invalid rollout plan");
  if (plan.remote_executable_code !== false) fail("rollout plan must remain data-only");

  const parallelStagingReady = hasIsolatedParallelTargets(plan);
  if (!compatibility.accepts_schema_v2 && !parallelStagingReady) {
    fail("store/main is schema-v1-only and rollout lacks isolated parallel-v2 targets");
  }
  if (requireCompatible && !compatibility.accepts_schema_v2) {
    fail("store/main is still schema-v1-only; in-place schema-v2 publication is blocked");
  }
  if (plan.publication_authorized === true && !compatibility.accepts_schema_v2) {
    fail("publication authorization is unsafe while store/main is schema-v1-only");
  }
  return {
    schema: 1,
    purpose: "Store compatibility gate for xADKiller schema-v2 protection-feed rollout. This report authorizes no publication and executes no remote code.",
    store_compatibility: compatibility,
    rollout_publication_authorized: plan.publication_authorized === true,
    in_place_schema_v2_publication_blocked: !compatibility.accepts_schema_v2,
    parallel_v2_staging_ready: parallelStagingReady,
    required_strategy: compatibility.safe_strategy,
    remote_executable_code: false
  };
}

async function main() {
  const storeRoot = resolve(option("store-root", defaultStoreRoot));
  const planPath = resolve(extensionRoot, option("plan", "packages/feed-v2-candidates/rollout-plan.json"));
  const outValue = option("out", "");
  const outputPath = outValue ? resolve(extensionRoot, outValue) : "";
  const requireCompatible = process.argv.includes("--require-compatible");

  const [background, serviceWorker, planText] = await Promise.all([
    readFile(resolve(storeRoot, "browser-extension/common/background.js"), "utf8"),
    readFile(resolve(storeRoot, "browser-extension/common/service-worker.js"), "utf8"),
    readFile(planPath, "utf8")
  ]);
  const plan = JSON.parse(planText);
  const compatibility = inspectStoreCompatibility(background, serviceWorker);
  const report = validatePublicationSafety(plan, compatibility, requireCompatible);

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const status = report.in_place_schema_v2_publication_blocked ? "IN_PLACE_BLOCKED" : "COMPATIBLE";
  console.log(
    `Feed v2 store compatibility: ${status} • strategy=${report.required_strategy} • `
    + `parallel_v2_staging_ready=${report.parallel_v2_staging_ready} • strict_v1=${compatibility.strict_v1_consumer} `
    + `• compat=${compatibility.feed_v2_compat_loaded} • publication_authorized=${report.rollout_publication_authorized}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
