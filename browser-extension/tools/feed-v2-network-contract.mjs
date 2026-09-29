const RAW_PREFIX = "https://raw.githubusercontent.com/Swir/xADKiller/";
export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const FEED_FETCH_TIMEOUT_MS = 15 * 1000;
export const FEED_ACCEPT = "application/json,text/plain;q=0.9,application/octet-stream;q=0.8";
const ALLOWED_CONTENT_TYPES = new Set(["application/json", "text/plain", "application/octet-stream"]);

function fail(message) {
  throw new Error(`feed_v2_network_contract: ${message}`);
}

export function validatePinnedSource(pinned) {
  if (!pinned || typeof pinned !== "object") fail("missing pinned feed descriptor");
  const id = String(pinned.id || "").trim();
  const sourceRef = String(pinned.source_ref || "").trim();
  const path = String(pinned.path || "").trim();

  if (!/^[a-z0-9-]+$/.test(id)) fail("invalid feed id");
  // Keep the remote identity unambiguous. Production refs are dedicated branch/tag names;
  // slash-bearing refs would be indistinguishable from the repository path in raw URLs.
  if (!/^[A-Za-z0-9._-]+$/.test(sourceRef) || sourceRef === "." || sourceRef === "..") {
    fail(`${id}: unsafe source_ref`);
  }
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    fail(`${id}: unsafe source path`);
  }
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    fail(`${id}: unsafe source path`);
  }
  return { id, sourceRef, path };
}

export function buildPinnedUrl(pinned) {
  const { sourceRef, path } = validatePinnedSource(pinned);
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${RAW_PREFIX}${encodeURIComponent(sourceRef)}/${encodedPath}`;
}

function contentLength(response) {
  const raw = String(response?.headers?.get?.("content-length") || "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) fail("invalid Content-Length");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid Content-Length");
  if (value > MAX_FEED_BYTES) fail("declared body exceeds 2 MiB ceiling");
  return value;
}

export function validateProductionResponse(response, expectedUrl) {
  if (!response || typeof response !== "object") fail("missing response");
  if (response.redirected === true) fail("redirected production response");
  if (Number(response.status) !== 200 || response.ok !== true) fail(`production fetch returned HTTP ${response.status}`);
  const finalUrl = String(response.url || "").trim();
  if (!finalUrl || finalUrl !== expectedUrl) fail("production response provenance mismatch");

  const contentType = String(response.headers?.get?.("content-type") || "").trim().toLowerCase();
  const mediaType = contentType.split(";", 1)[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(mediaType)) fail("production response has unapproved MIME");
  contentLength(response);
  return response;
}

export async function readBoundedUtf8(response) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") fail("production response has no readable body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal:true });
  let text = "";
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part?.done) break;
      const chunk = part?.value instanceof Uint8Array ? part.value : new Uint8Array(part?.value || 0);
      total += chunk.byteLength;
      if (total > MAX_FEED_BYTES) {
        try { await reader.cancel("xad_feed_v2_payload_size"); } catch (_) {}
        fail("streamed body exceeds 2 MiB ceiling");
      }
      try { text += decoder.decode(chunk, { stream:true }); }
      catch (_) { fail("production response is not valid UTF-8"); }
    }
    try { text += decoder.decode(); }
    catch (_) { fail("production response is not valid UTF-8"); }
  } finally {
    try { reader.releaseLock?.(); } catch (_) {}
  }

  const declared = contentLength(response);
  const encoding = String(response?.headers?.get?.("content-encoding") || "").trim().toLowerCase();
  if (declared != null && (!encoding || encoding === "identity") && declared !== total) {
    fail("Content-Length does not match delivered body");
  }
  return { text, actualBytes:total };
}

export async function fetchPinnedJson(pinned, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") fail("fetch implementation unavailable");
  const { id } = validatePinnedSource(pinned);
  const expectedUrl = buildPinnedUrl(pinned);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(expectedUrl, {
      method:"GET",
      headers:{ accept:FEED_ACCEPT, "user-agent":"xADKiller-feed-v2-preflight" },
      cache:"no-store",
      redirect:"error",
      credentials:"omit",
      referrerPolicy:"no-referrer",
      signal:controller.signal
    });
  } catch (error) {
    fail(`${id}: production fetch failed (${error?.name || "network"})`);
  } finally {
    clearTimeout(timer);
  }

  validateProductionResponse(response, expectedUrl);
  const { text, actualBytes } = await readBoundedUtf8(response);
  let json;
  try { json = JSON.parse(text); }
  catch (_) { fail(`${id}: production payload is not valid JSON`); }
  return { text, json, expectedUrl, actualBytes };
}
