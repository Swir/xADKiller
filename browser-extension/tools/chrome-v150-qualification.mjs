#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist", "chrome");
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 20_000;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REQUIRED_GATES = Object.freeze([
  "validate",
  "test:chrome",
  "test:compat",
  "test:language",
  "test:memory",
  "test:pause",
  "test:feeds",
  "test:feed-v2-consumers",
  "test:feed-checksums",
  "test:layer-dedupe",
  "test:rule-ranking",
  "test:benchmark",
  "test:shadow-soak",
  "test:real-page",
  "test:performance"
]);

function fail(message) {
  throw new Error(message);
}

function sha256File(target) {
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PACKAGE_BYTES) {
    fail(`beta ZIP must be 1 byte..${MAX_PACKAGE_BYTES} bytes`);
  }
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(target, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.error) fail(`${name} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    fail(`${name} ${args.join(" ")} failed (${result.status})${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function checkoutIdentity(expectedCommit) {
  const value = String(expectedCommit || "").trim().toLowerCase();
  if (!COMMIT_RE.test(value)) fail("--expected-commit must be a 40-character lowercase Git commit");
  const actual = command("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toLowerCase();
  if (actual !== value) fail(`checkout commit mismatch (${actual} != ${value})`);
  const dirty = command("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT });
  if (dirty) fail("tracked checkout is dirty; qualification requires the exact clean source commit");
  return actual;
}

function extractZip(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "$z=[System.IO.Compression.ZipFile]::OpenRead($env:XAD_ZIP)",
      "try { foreach($e in $z.Entries) { $n=$e.FullName.Replace('\\','/'); if($n.StartsWith('/') -or $n -match '(^|/)\\.\\.(/|$)' -or $n -match '^[A-Za-z]:') { throw ('unsafe ZIP entry: '+$n) } } } finally { $z.Dispose() }",
      "Expand-Archive -LiteralPath $env:XAD_ZIP -DestinationPath $env:XAD_DEST -Force"
    ].join("; ");
    command("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, XAD_ZIP: zipPath, XAD_DEST: dest }
    });
    return;
  }

  const listing = command("unzip", ["-Z1", zipPath]);
  for (const raw of listing.split(/\r?\n/)) {
    const name = raw.replaceAll("\\", "/");
    if (!name) continue;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..")) {
      fail(`unsafe ZIP entry: ${name}`);
    }
  }
  command("unzip", ["-qq", zipPath, "-d", dest]);
}

function inspectExtractedTree(root) {
  const manifests = [];
  const stack = [root];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail(`symlink is not allowed in beta ZIP: ${path.relative(root, full)}`);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!stat.isFile()) fail(`unsupported ZIP entry type: ${path.relative(root, full)}`);
      files += 1;
      bytes += stat.size;
      if (files > MAX_EXTRACTED_FILES) fail(`beta ZIP exceeds ${MAX_EXTRACTED_FILES} extracted files`);
      if (bytes > MAX_EXTRACTED_BYTES) fail(`beta ZIP exceeds ${MAX_EXTRACTED_BYTES} extracted bytes`);
      if (entry.name === "manifest.json") manifests.push(full);
    }
  }
  if (manifests.length !== 1) fail(`beta ZIP must contain exactly one manifest.json; found ${manifests.length}`);
  const extensionRoot = path.dirname(manifests[0]);
  const manifest = JSON.parse(fs.readFileSync(manifests[0], "utf8"));
  if (manifest.manifest_version !== 3) fail("beta ZIP is not a Manifest V3 extension");
  if (!manifest.permissions?.includes("declarativeNetRequest")) fail("beta ZIP is missing declarativeNetRequest permission");
  return { extensionRoot, files, bytes, version: String(manifest.version || "") };
}

function stageExactPackage(extensionRoot) {
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  const backup = `${DIST}.qualification-backup-${process.pid}`;
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  const hadDist = fs.existsSync(DIST);
  if (hadDist) fs.renameSync(DIST, backup);
  try {
    fs.cpSync(extensionRoot, DIST, { recursive: true, force: false, errorOnExist: false });
  } catch (error) {
    if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
    if (hadDist && fs.existsSync(backup)) fs.renameSync(backup, DIST);
    throw error;
  }
  return () => {
    if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
    if (hadDist && fs.existsSync(backup)) fs.renameSync(backup, DIST);
  };
}

function runRuntimeGates() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const passed = [];
  for (const script of REQUIRED_GATES) {
    console.log(`[xADKiller QUALIFY] running npm run ${script}`);
    command(npm, ["run", script], { cwd: ROOT, inherit: true });
    passed.push(script);
  }
  return passed;
}

function writeAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--witness=")) out.witness = arg.slice(10);
    else if (arg.startsWith("--package=")) out.package = arg.slice(10);
    else if (arg.startsWith("--expected-commit=")) out.expectedCommit = arg.slice(18);
    else if (arg.startsWith("--output=")) out.output = arg.slice(9);
    else if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return "Usage: npm run qualify:v150 -- --witness=beta-review.json --package=xADKiller.zip --expected-commit=<40hex> [--output=qualification.json]";
}

function selfTest() {
  if (REQUIRED_GATES.length < 10) fail("qualification gate set unexpectedly shrank");
  for (const required of ["test:benchmark", "test:real-page", "test:shadow-soak", "test:performance", "test:feeds"]) {
    if (!REQUIRED_GATES.includes(required)) fail(`missing required gate: ${required}`);
  }
  if (!COMMIT_RE.test("a".repeat(40)) || COMMIT_RE.test("a".repeat(39))) fail("commit regex self-test failed");
  if (!SHA256_RE.test("b".repeat(64)) || SHA256_RE.test("b".repeat(63))) fail("sha256 regex self-test failed");
  console.log(`Chrome v1.5 qualification contract self-test: PASS (${REQUIRED_GATES.length} runtime gates)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  if (!args.witness || !args.package || !args.expectedCommit) fail("--witness --package and --expected-commit are required");

  const expectedCommit = checkoutIdentity(args.expectedCommit);
  const packagePath = path.resolve(args.package);
  const witnessPath = path.resolve(args.witness);
  if (!fs.existsSync(witnessPath)) fail(`witness not found: ${witnessPath}`);
  const packageSha256 = sha256File(packagePath);
  if (!SHA256_RE.test(packageSha256)) fail("computed package SHA-256 is invalid");

  const witness = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
  const { validateWitness } = await import("./validate-normal-browsing-v2-witness.mjs");
  const witnessResult = validateWitness(witness, {
    expectedCommit,
    expectedPackageSha256: packageSha256
  });
  if (!witnessResult.ok) fail(`normal-browsing v2 witness blocked: ${witnessResult.blockers.join(", ")}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xadkiller-v150-qualification-"));
  let restoreDist = null;
  try {
    extractZip(packagePath, tempRoot);
    const packageInfo = inspectExtractedTree(tempRoot);
    restoreDist = stageExactPackage(packageInfo.extensionRoot);
    const passed = runRuntimeGates();
    const result = {
      schema: 1,
      scope: "xADKiller Chrome v1.5 exact-package qualification",
      candidate: {
        source_commit: expectedCommit,
        package_sha256: packageSha256,
        manifest_version: 3,
        extension_version: packageInfo.version,
        extracted_files: packageInfo.files,
        extracted_bytes: packageInfo.bytes,
        bound: true
      },
      manual_beta_witness: {
        integrity_passed: true,
        pinned_ref: witnessResult.summary.pinned_ref,
        validated_feeds: witnessResult.summary.validated_feeds,
        observations: witnessResult.summary.observations,
        unique_hosts: witnessResult.summary.unique_hosts
      },
      runtime_gates: passed.map((name) => ({ name, status: "PASS" })),
      qualification_review_ready: true,
      release_gate_closed: false,
      note: "The exact ZIP passed the local runtime gate set and the privacy-safe pinned-v2 witness is bound to the same ZIP/commit. Store publication and main merge remain separate policy decisions."
    };
    if (args.output) writeAtomic(path.resolve(args.output), result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { if (restoreDist) restoreDist(); } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
  }
}

main().catch((error) => {
  console.error(`Chrome v1.5 qualification: FAIL: ${error?.message || error}`);
  console.error(usage());
  process.exitCode = 2;
});
