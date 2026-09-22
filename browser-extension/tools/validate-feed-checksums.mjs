import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const manifestPath = path.join(repoRoot, "browser-intelligence", "feed-checksums.json");
const OWNER = "Swir";
const REPO = "xADKiller";
const TIMEOUT_MS = 12_000;

function fail(message) {
  throw new Error(`[xADKiller FEED CHECKSUM] ${message}`);
}

function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(bytes).digest("hex");
}

function isSafeRef(value) {
  return typeof value === "string" && /^[A-Za-z0-9._/-]{1,120}$/.test(value) && !value.includes("..") && !value.startsWith("/");
}

function isSafePath(value) {
  return typeof value === "string" && value.startsWith("browser-intelligence/") && /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..") && value.endsWith(".json");
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache:"no-store",
      signal:controller.signal,
      headers:{ accept:"application/json", "user-agent":"xADKiller-feed-checksum-ci" }
    });
    if (!response.ok) fail(`HTTP ${response.status} for ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest?.schema !== 1) fail("manifest schema must be 1");
if (manifest?.algorithm !== "git-blob-sha1") fail("manifest algorithm must be git-blob-sha1");
if (!Array.isArray(manifest?.feeds) || manifest.feeds.length < 3) fail("manifest must list the three production feed roles");

const ids = new Set();
const required = new Set(["live-shield", "live-matrix", "titan"]);
for (const entry of manifest.feeds) {
  const id = String(entry?.id || "");
  if (!required.has(id)) fail(`unexpected feed id ${id || "<empty>"}`);
  if (ids.has(id)) fail(`duplicate feed id ${id}`);
  ids.add(id);
  if (!isSafeRef(entry.source_ref)) fail(`unsafe source_ref for ${id}`);
  if (!isSafePath(entry.path)) fail(`unsafe path for ${id}`);
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(entry.feed_version || ""))) fail(`invalid feed_version for ${id}`);
  if (!Number.isFinite(Date.parse(String(entry.updated_at || "")))) fail(`invalid updated_at for ${id}`);
  if (!/^[0-9a-f]{40}$/.test(String(entry.git_blob_sha1 || ""))) fail(`invalid git_blob_sha1 for ${id}`);

  const encodedPath = entry.path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(entry.source_ref)}/${encodedPath}`;
  const bytes = await fetchBytes(url);
  if (bytes.length < 80 || bytes.length > 2_000_000) fail(`implausible payload size for ${id}: ${bytes.length}`);
  const actualSha = gitBlobSha1(bytes);
  if (actualSha !== entry.git_blob_sha1) fail(`${id} checksum drift: expected ${entry.git_blob_sha1}, got ${actualSha}`);

  let data;
  try { data = JSON.parse(bytes.toString("utf8")); } catch (_) { fail(`${id} payload is not valid JSON`); }
  if (data?.schema !== 1) fail(`${id} remote schema drift: ${data?.schema}`);
  if (String(data?.feed_version || "") !== entry.feed_version) fail(`${id} version drift: manifest=${entry.feed_version} remote=${data?.feed_version}`);
  if (String(data?.updated_at || "") !== entry.updated_at) fail(`${id} timestamp drift: manifest=${entry.updated_at} remote=${data?.updated_at}`);
  const description = String(data?.description || "").toLowerCase();
  if (id === "titan" && !description.includes("no executable remote code")) fail("TITAN data-only declaration missing");
  if ((id === "live-shield" || id === "live-matrix") && !description.includes("data-only")) fail(`${id} data-only declaration missing`);

  console.log(`[xADKiller FEED CHECKSUM] ${id} OK • ${entry.source_ref} • ${entry.feed_version} • ${actualSha}`);
}

for (const id of required) if (!ids.has(id)) fail(`missing required feed id ${id}`);
console.log("[xADKiller FEED CHECKSUM] PASS • all production GitHub protection feeds match deterministic repository checksums and metadata");
