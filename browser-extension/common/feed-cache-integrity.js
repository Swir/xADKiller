(() => {
  if (globalThis.__xadFeedCacheIntegrityV1) return;
  globalThis.__xadFeedCacheIntegrityV1 = true;

  const local = chrome?.storage?.local;
  const subtle = globalThis.crypto?.subtle;
  if (!local || !subtle || typeof TextEncoder === "undefined") return;

  const SPECS = Object.freeze([
    Object.freeze({
      kind:"live-shield",
      digestKey:"xadCacheDigestLiveShieldV1",
      keys:Object.freeze(["liveFeedVersion","liveFeedUpdatedAt","liveFeedFetchedAt","liveStandardDomains","liveUltraDomains"])
    }),
    Object.freeze({
      kind:"live-matrix",
      digestKey:"xadCacheDigestLiveMatrixV1",
      keys:Object.freeze(["xadLiveMatrixVersion","xadLiveMatrixFetchedAt","xadLiveSignaturesStandard","xadLiveSignaturesUltra","xadLiveCosmeticStandard","xadLiveCosmeticUltra"])
    }),
    Object.freeze({
      kind:"titan",
      digestKey:"xadCacheDigestTitanV1",
      keys:Object.freeze(["xadTitanFeed","xadTitanFetchedAt"])
    })
  ]);

  const DIGEST_KEYS = new Set(SPECS.map((spec) => spec.digestKey));
  const KEY_TO_SPEC = new Map();
  for (const spec of SPECS) for (const key of spec.keys) KEY_TO_SPEC.set(key, spec);

  const nativeGet = local.get.bind(local);
  const nativeSet = local.set.bind(local);
  const nativeRemove = typeof local.remove === "function" ? local.remove.bind(local) : null;
  let writeChain = Promise.resolve();

  function callGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        const maybe = nativeGet(keys, (value) => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve(value || {});
        });
        if (maybe && typeof maybe.then === "function") maybe.then((value) => resolve(value || {}), reject);
      } catch (error) { reject(error); }
    });
  }

  function callSet(values) {
    return new Promise((resolve, reject) => {
      try {
        const maybe = nativeSet(values, () => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve();
        });
        if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }

  function callRemove(keys) {
    if (!nativeRemove) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        const maybe = nativeRemove(keys, () => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve();
        });
        if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }

  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }

  function bundleFrom(store, spec) {
    const out = {};
    for (const key of spec.keys) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
    return out;
  }

  function hasBundleData(store, spec) {
    return spec.keys.some((key) => Object.prototype.hasOwnProperty.call(store, key));
  }

  async function digestBundle(store, spec) {
    const bytes = new TextEncoder().encode(`${spec.kind}\n${canonical(bundleFrom(store, spec))}`);
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function requestKeys(keys) {
    if (keys == null) return null;
    if (typeof keys === "string") return new Set([keys]);
    if (Array.isArray(keys)) return new Set(keys.map(String));
    if (typeof keys === "object") return new Set(Object.keys(keys));
    return new Set();
  }

  function specsForRequest(keys) {
    const requested = requestKeys(keys);
    if (requested === null) return SPECS;
    const found = new Set();
    for (const key of requested) {
      const spec = KEY_TO_SPEC.get(key);
      if (spec) found.add(spec);
    }
    return [...found];
  }

  function selectResult(store, keys) {
    if (keys == null) {
      const out = { ...store };
      for (const digestKey of DIGEST_KEYS) delete out[digestKey];
      return out;
    }
    if (typeof keys === "string") return Object.prototype.hasOwnProperty.call(store, keys) ? { [keys]:store[keys] } : {};
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
      return out;
    }
    if (typeof keys === "object") {
      const out = {};
      for (const [key, fallback] of Object.entries(keys)) out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
      return out;
    }
    return {};
  }

  async function verifyStore(store, specs) {
    const safe = { ...store };
    for (const spec of specs) {
      if (!hasBundleData(safe, spec)) continue;
      const expected = String(safe[spec.digestKey] || "");
      const purge = [...spec.keys, spec.digestKey];

      if (!expected) {
        // A legacy/unsealed fallback has no integrity evidence. Do not return it even once:
        // purge only this feed bundle and fall back to packaged/static protection until the
        // next validated network refresh repopulates a newly sealed cache. This prevents a
        // corrupted pre-upgrade cache from becoming trusted merely because it was first.
        for (const key of purge) delete safe[key];
        writeChain = writeChain.then(() => callRemove(purge)).catch(() => {});
        continue;
      }

      const actual = await digestBundle(safe, spec);
      if (expected === actual) continue;

      // Corrupted/tampered fallback is never returned to feed consumers. Purge only this
      // feed bundle; packaged/static protection remains active and the next network fetch
      // can repopulate it through the normal Feed Guard path.
      for (const key of purge) delete safe[key];
      writeChain = writeChain.then(() => callRemove(purge)).catch(() => {});
    }
    return safe;
  }

  async function protectedGet(keys) {
    const specs = specsForRequest(keys);
    if (!specs.length) return callGet(keys);
    await writeChain;
    const store = await callGet(null);
    return selectResult(await verifyStore(store, specs), keys);
  }

  async function protectedSet(values) {
    const cleanValues = values && typeof values === "object" ? { ...values } : {};
    for (const digestKey of DIGEST_KEYS) delete cleanValues[digestKey];
    const touched = new Set();
    for (const key of Object.keys(cleanValues)) {
      const spec = KEY_TO_SPEC.get(key);
      if (spec) touched.add(spec);
    }
    if (!touched.size) return callSet(cleanValues);

    writeChain = writeChain.then(async () => {
      const current = await callGet(null);
      const merged = { ...current, ...cleanValues };
      const sealed = { ...cleanValues };
      for (const spec of touched) sealed[spec.digestKey] = await digestBundle(merged, spec);
      await callSet(sealed);
    });
    return writeChain;
  }

  local.get = function(keys, callback) {
    const task = protectedGet(keys);
    if (typeof callback === "function") {
      task.then((value) => callback(value), () => callback(selectResult({}, keys)));
      return undefined;
    }
    return task;
  };

  local.set = function(values, callback) {
    const task = protectedSet(values);
    if (typeof callback === "function") {
      task.then(() => callback(), () => callback());
      return undefined;
    }
    return task;
  };

  globalThis.XAD_FEED_CACHE_INTEGRITY = Object.freeze({ specs:SPECS, canonical, bundleFrom, digestBundle });
})();
