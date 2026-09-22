import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "common", "feed-rollback-provenance.js"), "utf8");

const URLS = Object.freeze({
  "live-shield":"https://raw.githubusercontent.com/Swir/xADKiller/live-shield-feed/browser-intelligence/xadkiller-live-shield.json",
  "live-matrix":"https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-live-shield.json",
  "titan":"https://raw.githubusercontent.com/Swir/xADKiller/main/browser-intelligence/xadkiller-titan-feed.json"
});
const REFS = Object.freeze({
  "live-shield":"live-shield-feed/browser-intelligence/xadkiller-live-shield.json",
  "live-matrix":"main/browser-intelligence/xadkiller-live-shield.json",
  "titan":"main/browser-intelligence/xadkiller-titan-feed.json"
});
const VERSIONS = Object.freeze({
  "live-shield":"2026.09.13.1",
  "live-matrix":"2026.09.13.2",
  "titan":"2026.09.13.1"
});

function makePayload(kind, overrideRef = null, overrideVersion = null) {
  return {
    schema:2,
    feed_version:"2026.09.18.1",
    updated_at:"2026-09-18T01:30:00Z",
    expires_at:"2026-10-18T01:30:00Z",
    rollback:{
      previous_version:overrideVersion ?? VERSIONS[kind],
      previous_ref:overrideRef ?? REFS[kind]
    }
  };
}

async function makeGuard(payloadByUrl) {
  const calls = [];
  const context = {
    URL,
    Response,
    TypeError,
    console,
    globalThis:null,
    fetch:async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      calls.push(url);
      const payload = payloadByUrl[url] ?? { schema:1, feed_version:"x", updated_at:"2026-09-18T01:30:00Z" };
      return new Response(JSON.stringify(payload), { status:200, headers:{ "content-type":"application/json" } });
    }
  };
  context.globalThis = context;
  context.__calls = calls;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"feed-rollback-provenance.js" });
  return context;
}

async function expectReject(promise, label, reason) {
  let message = "";
  try { await promise; } catch (error) { message = String(error?.message || error); }
  if (!message.includes(`xad_feed_guard_${reason}`)) {
    throw new Error(`${label} was not rejected for ${reason}: ${message}`);
  }
}

{
  const payloads = Object.fromEntries(Object.entries(URLS).map(([kind, url]) => [url, makePayload(kind)]));
  const guard = await makeGuard(payloads);
  for (const [kind, url] of Object.entries(URLS)) {
    const response = await guard.fetch(url);
    if (!response.ok) throw new Error(`${kind}: approved rollback provenance unexpectedly failed`);
    if (!guard.XAD_FEED_ROLLBACK_PROVENANCE.validateRollbackProvenance(kind, makePayload(kind))) {
      throw new Error(`${kind}: direct provenance validation failed`);
    }
  }
}

{
  const wrongRefs = {
    "live-shield":REFS["live-matrix"],
    "live-matrix":REFS.titan,
    "titan":"main/browser-extension/common/background.js"
  };
  for (const [kind, url] of Object.entries(URLS)) {
    const guard = await makeGuard({ [url]:makePayload(kind, wrongRefs[kind]) });
    await expectReject(guard.fetch(url), `${kind}: cross-feed or executable-path rollback ref`, "rollback_provenance");
  }
}

{
  for (const [kind, url] of Object.entries(URLS)) {
    const wrongVersion = kind === "live-matrix" ? "2026.09.13.1" : "2026.09.12.9";
    const guard = await makeGuard({ [url]:makePayload(kind, null, wrongVersion) });
    await expectReject(guard.fetch(url), `${kind}: stale or mismatched rollback generation`, "rollback_version");
  }
}

{
  const url = URLS["live-shield"];
  const guard = await makeGuard({
    [url]:{ schema:1, feed_version:"2026.09.13.1", updated_at:"2026-09-13T15:05:00Z" }
  });
  const response = await guard.fetch(url);
  if (!response.ok) throw new Error("schema-v1 compatibility regressed");
}

{
  const unrelated = "https://example.test/feed.json";
  const guard = await makeGuard({ [unrelated]:makePayload("live-shield", "totally/unrelated/ref") });
  const response = await guard.fetch(unrelated);
  if (!response.ok || guard.__calls.length !== 1 || guard.__calls[0] !== unrelated) {
    throw new Error("non-protection fetch was modified");
  }
}

{
  const url = `${URLS.titan}?v=1726668000000`;
  const guard = await makeGuard({ [url]:makePayload("titan") });
  const response = await guard.fetch(url);
  if (!response.ok) throw new Error("approved legacy numeric cache-buster compatibility regressed");
}

console.log("Chrome feed rollback provenance regression: PASS (path + exact previous generation pinned)");
