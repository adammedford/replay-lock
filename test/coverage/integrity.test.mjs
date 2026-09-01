import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(root, "scripts", "coverage", "verify-report.mjs");

test("scheduled coverage is read-only, pinned, bounded, and informational", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "coverage.yml"), "utf8");
  const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    const pin = new RegExp(`uses: ${action.replace("/", "\\/")}@([a-f0-9]{40}) # (v\\d+\\.\\d+\\.\\d+)`);
    assert.match(workflow, pin);
    assert.deepEqual(workflow.match(pin).slice(1), ci.match(pin).slice(1), `${action} pin and release comment must match reviewed CI`);
  }
  assert.match(workflow, /cron: '17 6 \* \* 2'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|\npush:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /npm install --global npm@11\.5\.2/);
  assert.equal(workflow.match(/npm run coverage/g)?.length, 1);
  assert.match(workflow, /path: coverage\//);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /if-no-files-found: error/);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(manifest.devDependencies.c8, "12.0.0");
  assert.equal(lock.packages["node_modules/c8"].version, "12.0.0");
});

test("coverage integrity rejects a report that omits a tracked TypeScript source", async () => {
  const fixture = await reportFixture();
  try {
    const complete = check(fixture);
    assert.equal(complete.status, 0, complete.output);
    assert.match(complete.output, /coverage integrity verified/);
    const report = JSON.parse(await readFile(fixture.reportFile, "utf8"));
    delete report[path.join(fixture.project, "src", "unloaded.ts")];
    await writeFile(fixture.reportFile, JSON.stringify(report));
    const missing = check(fixture);
    assert.equal(missing.status, 1, missing.output);
    assert.match(missing.output, /missing tracked source: src\/unloaded\.ts/);
    assert.doesNotMatch(missing.output, /coverage integrity verified/);
  } finally {
    await rm(fixture.project, { recursive: true, force: true });
  }
});

test("coverage integrity rejects dist paths and foreign installed or fixture copies", async () => {
  const fixture = await reportFixture();
  try {
    const original = JSON.parse(await readFile(fixture.reportFile, "utf8"));
    for (const leaked of ["dist/runtime.js", "node_modules/replaylock/src/runtime.ts", "test/fixture/src/runtime.ts"]) {
      const file = path.join(fixture.project, leaked);
      const report = { ...original, [file]: { ...Object.values(original)[0], path: file } };
      await writeFile(fixture.reportFile, JSON.stringify(report));
      const result = check(fixture);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /unexpected coverage source/);
    }
    const first = Object.keys(original)[0];
    original[first].path = path.join(fixture.project, "dist", "cli.js");
    await writeFile(fixture.reportFile, JSON.stringify(original));
    assert.match(check(fixture).output, /coverage key and source path disagree/);
  } finally {
    await rm(fixture.project, { recursive: true, force: true });
  }
});

test("coverage integrity requires executed CLI, Vite transform, and Vitest-worker runtime evidence", async () => {
  const fixture = await reportFixture();
  try {
    for (const [name, role] of [
      ["coverage-10001-1000-0.json", "CLI"],
      ["coverage-10002-1000-0.json", "Vite transform"],
      ["coverage-10003-1000-0.json", "Vitest worker runtime"],
    ]) {
      const file = path.join(fixture.raw, name);
      const original = await readFile(file, "utf8");
      await rm(file);
      const absent = check(fixture);
      assert.equal(absent.status, 1, absent.output);
      assert.ok(absent.output.includes(`missing child execution: ${role}`), absent.output);
      const notExecuted = JSON.parse(original);
      for (const script of notExecuted.result) {
        for (const fn of script.functions) fn.ranges[0].count = 0;
      }
      await writeFile(file, JSON.stringify(notExecuted));
      assert.equal(check(fixture).status, 1, "loading an unexecuted function must not satisfy child evidence");
      await writeFile(file, original);
    }
    const workerFile = path.join(fixture.raw, "coverage-10003-1000-0.json");
    const worker = JSON.parse(await readFile(workerFile, "utf8"));
    worker.result[0].url = pathToFileURL(path.join(fixture.project, "test", "acceptance", "recording-integration.test.mjs")).href;
    await writeFile(workerFile, JSON.stringify(worker));
    const parentOnly = check(fixture);
    assert.equal(parentOnly.status, 1, parentOnly.output);
    assert.match(parentOnly.output, /missing child execution: Vitest worker runtime/);
  } finally {
    await rm(fixture.project, { recursive: true, force: true });
  }
});

test("coverage integrity rejects dropped source-map hits even when raw child evidence survives", async () => {
  const fixture = await reportFixture();
  try {
    const original = JSON.parse(await readFile(fixture.reportFile, "utf8"));
    for (const name of ["cli.ts", "vite-plugin.ts", "runtime.ts"]) {
      const report = structuredClone(original);
      report[path.join(fixture.project, "src", name)].f[0] = 0;
      await writeFile(fixture.reportFile, JSON.stringify(report));
      const missing = check(fixture);
      assert.equal(missing.status, 1, missing.output);
      assert.match(missing.output, /missing mapped child execution/);
    }
  } finally {
    await rm(fixture.project, { recursive: true, force: true });
  }
});

async function reportFixture() {
  const project = await realpath(await mkdtemp(path.join(os.tmpdir(), "replaylock-coverage-integrity-")));
  const reports = path.join(project, "coverage");
  const raw = path.join(project, "raw");
  await mkdir(path.join(project, "src"));
  await mkdir(reports);
  await mkdir(raw);
  // Istanbul and V8 documents are the checker CLI's external input boundary.
  // This fixture tests integrity, not application coverage or a percentage claim.
  const report = {};
  for (const file of ["cli.ts", "runtime.ts", "vite-plugin.ts", "unloaded.ts"]) {
    const source = path.join(project, "src", file);
    await writeFile(source, "export const example = 1;\n");
    const functionName = { "cli.ts": "main", "runtime.ts": "observeCall", "vite-plugin.ts": "instrumentTarget" }[file];
    const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } };
    report[source] = {
      path: source,
      statementMap: { 0: location }, s: { 0: file === "unloaded.ts" ? 0 : 1 },
      fnMap: functionName ? { 0: { name: functionName, decl: location, loc: location } } : {},
      f: functionName ? { 0: 1 } : {}, branchMap: {}, b: {},
    };
  }
  for (const args of [["init", "--quiet"], ["add", "src"]]) {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const reportFile = path.join(reports, "coverage-final.json");
  await writeFile(reportFile, JSON.stringify(report));
  const script = (file, name) => ({
    scriptId: "1", url: pathToFileURL(path.join(project, file)).href,
    functions: [{ functionName: name, ranges: [{ startOffset: 0, endOffset: 25, count: 1 }], isBlockCoverage: true }],
  });
  await writeFile(path.join(raw, "coverage-10001-1000-0.json"), JSON.stringify({ result: [script("dist/cli.js", "main")] }));
  await writeFile(path.join(raw, "coverage-10002-1000-0.json"), JSON.stringify({ result: [
    script("node_modules/vitest/vitest.mjs", ""), script("dist/vite-plugin.js", "instrumentTarget"),
  ] }));
  await writeFile(path.join(raw, "coverage-10003-1000-0.json"), JSON.stringify({ result: [
    script("node_modules/vitest/dist/workers/forks.js", "run"), script("dist/runtime.js", "observeCall"),
  ] }));
  return { project, reports, reportFile, raw };
}

function check(fixture) {
  const result = spawnSync(process.execPath, [verifier, `--root=${fixture.project}`, `--reports=${fixture.reports}`, `--raw=${fixture.raw}`], {
    cwd: root, encoding: "utf8",
  });
  assert.ifError(result.error);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
