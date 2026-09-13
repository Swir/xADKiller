import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const common = path.join(root, "common");
const dist = path.join(root, "dist");
const resourceTypes = ["script","image","stylesheet","xmlhttprequest","sub_frame","media","ping","other"];
const domains = fs.readFileSync(path.join(common, "rules", "domains.txt"), "utf8")
  .split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

function makeRules() {
  const rules = domains.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: `||${domain}^`, resourceTypes }
  }));
  let id = rules.length + 1;
  for (const [urlFilter, types] of [
    ["/pagead/", ["script","xmlhttprequest","sub_frame","image"]],
    ["/gampad/", ["script","xmlhttprequest","sub_frame"]],
    ["adsbygoogle.js", ["script"]],
    ["prebid.js", ["script"]],
    ["/adservice/", ["script","xmlhttprequest","sub_frame","image"]]
  ]) rules.push({ id: id++, priority: 1, action: { type: "block" }, condition: { urlFilter, resourceTypes: types } });
  return rules;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const browser of ["chrome", "firefox"]) {
  const out = path.join(dist, browser);
  fs.cpSync(common, out, { recursive: true });
  fs.mkdirSync(path.join(out, "rules"), { recursive: true });
  fs.writeFileSync(path.join(out, "rules", "core.json"), JSON.stringify(makeRules(), null, 2));
  fs.rmSync(path.join(out, "rules", "domains.txt"), { force: true });
  fs.copyFileSync(path.join(root, browser, "manifest.json"), path.join(out, "manifest.json"));
}
console.log(`Built dist/chrome and dist/firefox with ${makeRules().length} DNR rules`);
