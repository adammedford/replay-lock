import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportOptions, trackedSources } from "./inputs.mjs";
import { scriptPath } from "./process-evidence.mjs";
import { sourceVariants } from "./normalize.mjs";

const installation = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = reportOptions(process.argv.slice(2));
const tracked = trackedSources(options.root);
const allowed = new Set(tracked.flatMap((file) => [
  path.join(options.root, file),
  path.join(options.root, file.replace(/^src\//, "dist/").replace(/\.ts$/, ".js")),
]));
const temporary = await mkdtemp(path.join(os.tmpdir(), "replaylock-coverage-report-"));
try {
  const filtered = path.join(temporary, "filtered");
  await mkdir(filtered);
  const normalize = sourceVariants(path.join(temporary, "variants"));
  // Filter before c8's merge to bound memory and exclude installed consumers or
  // copied runner fixtures. Preserve each retained V8 range and source map.
  for (const file of (await readdir(options.raw)).sort()) {
    if (!/^coverage-\d+-\d+-\d+\.json$/.test(file)) continue;
    const document = JSON.parse(await readFile(path.join(options.raw, file), "utf8"));
    assert.ok(Array.isArray(document.result), `invalid V8 coverage document: ${file}`);
    const selected = document.result.filter((script) => allowed.has(scriptPath(script.url)));
    if (!selected.length) continue;
    const [, pid, thread] = /^coverage-(\d+)-\d+-(\d+)\.json$/.exec(file);
    let captured = {};
    try {
      captured = JSON.parse(await readFile(path.join(options.raw, `sources-${pid}-${thread}.json`), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const worker = document.result.some((script) => /\/vitest\/dist\/workers\/(?:forks|threads)\.js$/.test(script.url));
    const result = [];
    const sourceMaps = {};
    for (const script of selected) {
      assert.ok(!worker || captured[script.scriptId], `missing captured worker source: ${script.url}`);
      const normalized = await normalize(script, captured[script.scriptId]);
      result.push(normalized.script);
      sourceMaps[normalized.script.url] = { data: normalized.sourceMap };
    }
    await writeFile(path.join(filtered, file), JSON.stringify({ result, "source-map-cache": sourceMaps }));
  }
  const config = path.join(temporary, "c8.json");
  await writeFile(config, JSON.stringify({
    all: true,
    src: [path.join(options.root, "src")],
    include: ["src/**/*.ts"],
    exclude: [],
    extension: [".ts", ".js"],
    "exclude-after-remap": true,
    "merge-async": true,
    "check-coverage": false,
    reporter: ["html", "lcovonly", "json", "json-summary", "text-summary"],
  }));
  const generated = spawnSync(process.execPath, [path.join(installation, "node_modules", "c8", "bin", "c8.js"),
    "report", `--config=${config}`, `--temp-directory=${filtered}`, `--reports-dir=${options.reports}`], {
    cwd: options.root, stdio: "inherit",
  });
  assert.ifError(generated.error);
  assert.equal(generated.status, 0, "c8 source-map report failed");
  console.log("source coverage reports generated");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
