#!/usr/bin/env node
/*
Form: Node JavaScript
Runtime: Local Node CLI / GitHub Actions
Purpose: Static sanity checks for HTML inline scripts, DOM ids, and Worker syntax.
Inputs: HTML files and Tilelli Worker scripts.
Outputs: Exit code and check summary.
Safety: Does not execute browser code; only parses scripts with Function constructor.
Relations: package.json, docs/tilelli-edge.workflow.yml.template, .github/workflows/tilelli-edge.yml, spec/specification-system.manifest.json.
*/
import fs from "node:fs";

const files = ["index.html", "tilaelia.html", "clock.html", "gaia.html", "lani.html", "esp.html"];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  scripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (error) {
      throw new Error(`${file} inline script ${index + 1} failed to parse: ${error.message}`);
    }
  });
  const ids = [...html.matchAll(/id="([^"]+)"/g)]
    .map(match => match[1])
    .filter(id => !id.includes("${"));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(`${file} has duplicate ids: ${[...new Set(duplicates)].join(", ")}`);
  }
  const dollarRefs = [...html.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);
  const domRefs = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map(match => match[1]);
  const missing = [...dollarRefs, ...domRefs].filter(id => !ids.includes(id));
  if (missing.length) {
    throw new Error(`${file} has missing element references: ${[...new Set(missing)].join(", ")}`);
  }
}

[
  "workers/tilelli-api/src/index.js",
  "workers/tilelli-renderer/src/index.js"
].forEach(file => {
  if (!fs.existsSync(file)) return;
  new Function(fs.readFileSync(file, "utf8").replace(/export default/, "const worker ="));
});
console.log(`Checked ${files.length} HTML files and Tilelli Worker syntax.`);
