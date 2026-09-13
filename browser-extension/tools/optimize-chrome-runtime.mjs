import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "chrome", "content.js");
let code = fs.readFileSync(target, "utf8");
const slow = `  function cssRule(selector) {\n    try { document.querySelector(selector); return \`${'${selector}'}{display:none!important;visibility:hidden!important}\`; } catch (_) { return \"\"; }\n  }`;
const fast = `  function cssRule(selector) {\n    // Selectors are pre-filtered at build time. Do not query the DOM thousands of times\n    // merely to validate syntax; Chrome's CSS parser safely ignores malformed rules.\n    return \`${'${selector}'}{display:none!important;visibility:hidden!important}\`;\n  }`;
if (!code.includes(slow)) {
  throw new Error("Expected cosmetic cssRule block not found; refusing silent optimization failure");
}
code = code.replace(slow, fast);
fs.writeFileSync(target, code);
console.log("OK: optimized cosmetic CSS runtime (removed per-selector document.querySelector validation)");
