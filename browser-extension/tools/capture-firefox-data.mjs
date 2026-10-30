import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "dist", "chrome");
const names = [
  "build-meta.js", "cosmetic-data.js", "dynamic-intel-meta.json",
  "titan-session-meta.json", "titan-boost-meta.json",
  "rules/standard.json", "rules/ultra.json", "rules/dynamic-intel.json",
  "rules/titan-session.json", "rules/titan-boost-1.json",
  "rules/titan-boost-2.json", "rules/titan-boost-3.json"
];
const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(base, name), "utf8").replace(/\r\n/g, "\n")]));
const packed = gzipSync(JSON.stringify({ schema: 1, files }), { level: 9 });
fs.writeFileSync(path.join(root, "firefox", "data-snapshot.json.gz"), packed);
console.log(`Firefox protection data snapshot: ${packed.length} bytes, SHA256 ${createHash("sha256").update(packed).digest("hex")}`);
