import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("npm verification rejects invalid options before tooling tests or package builds", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts.verify, "node scripts/verify.mjs");
  assert.equal(manifest.scripts.test, manifest.scripts.verify);
  const project = await createRunnerFixture();
  try {
    for (const options of [["--concurrency=3"], ["--unknown"], ["--reporter=dot", "--reporter=spec"], ["--junit=relative.xml"]]) {
      const result = runFixture(project, options, "verify.mjs");
      assert.equal(result.status, 2, result.output);
      assert.match(result.output, /Invalid verification option:/);
      assert.doesNotMatch(result.output, /MODULE_NOT_FOUND|Could not find|package contract verified|packed consumer verified/);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("invalid verification options fail before the package build starts", async () => {
  const project = await createRunnerFixture();
  try {
    for (const options of [
      ["--unknown"],
      ["--concurrency=0"],
      ["--concurrency=3"],
      ["--concurrency=1.0"],
      ["--concurrency", "2"],
      ["--concurrency=1", "--concurrency=2"],
      ["--reporter=tap"],
      ["--reporter=dot", "--reporter=spec"],
      ["--junit="],
      ["--junit=relative.xml"],
      [`--junit=${path.join(project, "one.xml")}`, `--junit=${path.join(project, "two.xml")}`],
      ["--"],
      ["test/acceptance/core.test.mjs"],
    ]) {
      const result = runFixture(project, options);
      assert.equal(result.status, 2, `${options.join(" ")}: ${result.output}`);
      assert.match(result.output, /Invalid verification option:/);
      assert.match(result.output, /Usage: node scripts\/run-verification\.mjs/);
      assert.doesNotMatch(result.output, /verify-package-contract|MODULE_NOT_FOUND/);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the default run executes every locked acceptance file once with concurrency two and dot output", async () => {
  const project = await createRunnerFixture({ complete: true });
  try {
    const result = runFixture(project);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /verification suite passed/);
    assert.match(result.output, /package contract verified[\s\S]*packed consumer verified[\s\S]*verification suite passed/);
    assert.doesNotMatch(result.output, /fixture case:/);
    const execution = await readExecution(project);
    assert.equal(execution.peakConcurrency, 2);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("serial reproduction emits readable spec output and a complete JUnit report", async () => {
  const project = await createRunnerFixture({ complete: true });
  try {
    const junit = path.join(project, "reports", "verification results=all.xml");
    const result = runFixture(project, ["--concurrency=1", "--reporter=spec", `--junit=${junit}`]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /fixture case: core\.test\.mjs/);
    assert.match(result.output, /verification suite passed/);
    assert.doesNotMatch(result.output, /<testsuites/);
    const report = await readFile(junit, "utf8");
    assert.match(report, /<testsuites\b/);
    for (const name of await acceptanceNames()) {
      assert.equal(report.split(`name="fixture case: ${name}"`).length - 1, 1, `${name} must appear once in JUnit`);
    }
    assert.doesNotMatch(report, /<failure\b/);
    const execution = await readExecution(project);
    assert.equal(execution.peakConcurrency, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("acceptance failures keep the complete JUnit diagnostics and fail verification", async () => {
  const project = await createRunnerFixture({ complete: true });
  try {
    await writeFile(path.join(project, "test", "acceptance", "core.test.mjs"), `
import test from "node:test";
test("seeded acceptance regression", () => { throw new Error("positive control failure"); });
`);
    const junit = path.join(project, "failures.xml");
    const result = runFixture(project, ["--concurrency=2", "--reporter=dot", `--junit=${junit}`]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /locked V1 black-box acceptance suite failed/);
    assert.doesNotMatch(result.output, /verification suite passed/);
    const report = await readFile(junit, "utf8");
    assert.match(report, /<failure\b/);
    assert.match(report, /positive control failure/);
    assert.match(report, /name="fixture case: tolerance-comparison\.test\.mjs"/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("manifest omissions, discoveries, and duplicates fail before building or running a partial suite", async () => {
  for (const change of ["missing", "extra", "duplicate"]) {
    const project = await createRunnerFixture({ suite: true });
    try {
      if (change === "missing") {
        await rm(path.join(project, "test", "acceptance", "core.test.mjs"));
      } else if (change === "extra") {
        await writeFile(path.join(project, "test", "acceptance", "unlisted.test.mjs"), "");
      } else {
        // Filesystem discovery cannot contain duplicates; seed a duplicate in this disposable manifest.
        const runner = path.join(project, "scripts", "run-verification.mjs");
        const source = await readFile(runner, "utf8");
        const entry = '  "test/acceptance/core.test.mjs",';
        const duplicated = source.replace(entry, `${entry}\n${entry}`);
        assert.notEqual(duplicated, source, "the manifest mutation control must change the fixture");
        await writeFile(runner, duplicated);
      }
      const result = runFixture(project);
      assert.equal(result.status, 1, `${change}: ${result.output}`);
      assert.match(result.output, /locked V1 suite manifest must include every acceptance file exactly once/);
      assert.doesNotMatch(result.output, /verification suite passed/);
      await assert.rejects(readFile(path.join(project, "runner-events.jsonl")), { code: "ENOENT" });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

async function createRunnerFixture({ complete = false, suite = complete } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-verification-"));
  try {
    await mkdir(path.join(project, "scripts"));
    for (const script of await readdir(path.join(root, "scripts"))) {
      if (["run-verification.mjs", "verification-options.mjs", "verify.mjs"].includes(script)) {
        await copyFile(path.join(root, "scripts", script), path.join(project, "scripts", script));
      }
    }
    if (complete) {
      for (const file of ["package.json", "package-lock.json", "tsconfig.json", ".nvmrc", ".gitignore", "LICENSE", "README.md", "SECURITY.md", "CONTRIBUTING.md"]) {
        await copyFile(path.join(root, file), path.join(project, file));
      }
      for (const script of ["verify-package-contract.mjs", "verify-packed-consumer.mjs"]) {
        await copyFile(path.join(root, "scripts", script), path.join(project, "scripts", script));
      }
      for (const directory of ["src", "docs", "examples"]) {
        await cp(path.join(root, directory), path.join(project, directory), { recursive: true });
      }
      await symlink(path.join(root, "node_modules"), path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    }
    if (suite) {
      await mkdir(path.join(project, "test", "acceptance"), { recursive: true });
      for (const name of await acceptanceNames()) {
        await writeFile(path.join(project, "test", "acceptance", name), `
import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import test from "node:test";

test(${JSON.stringify(`fixture case: ${name}`)}, async () => {
  appendFileSync(process.env.REPLAYLOCK_RUNNER_EVENTS, JSON.stringify({ kind: "start", file: ${JSON.stringify(name)} }) + "\\n");
  await setTimeout(75);
  appendFileSync(process.env.REPLAYLOCK_RUNNER_EVENTS, JSON.stringify({ kind: "finish", file: ${JSON.stringify(name)} }) + "\\n");
});
`);
      }
    }
    return project;
  } catch (error) {
    await rm(project, { recursive: true, force: true });
    throw error;
  }
}

async function acceptanceNames() {
  const names = (await readdir(path.join(root, "test", "acceptance"))).filter((name) => name.endsWith(".test.mjs")).sort();
  assert.equal(names.length, 35, "the approved acceptance manifest contains 35 files");
  return names;
}

async function readExecution(project) {
  const events = (await readFile(path.join(project, "runner-events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const started = [];
  const finished = [];
  const active = new Set();
  let peakConcurrency = 0;
  for (const event of events) {
    if (event.kind === "start") {
      assert.equal(active.has(event.file), false, `${event.file} started twice`);
      active.add(event.file);
      started.push(event.file);
      peakConcurrency = Math.max(peakConcurrency, active.size);
    } else {
      assert.equal(event.kind, "finish");
      assert.equal(active.delete(event.file), true, `${event.file} finished before starting`);
      finished.push(event.file);
    }
  }
  const expected = await acceptanceNames();
  assert.deepEqual(started.sort(), expected, "every acceptance file must start exactly once");
  assert.deepEqual(finished.sort(), expected, "every acceptance file must finish exactly once");
  assert.equal(active.size, 0);
  return { peakConcurrency };
}

function runFixture(project, options = [], entrypoint = "run-verification.mjs") {
  const env = { ...process.env, REPLAYLOCK_RUNNER_EVENTS: path.join(project, "runner-events.jsonl") };
  // The CLI launches a new test runner, not a descendant test inside this runner's isolation context.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [path.join(project, "scripts", entrypoint), ...options], {
    cwd: project,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
  assert.equal(result.error, undefined);
  return { ...result, output: `${result.stdout}${result.stderr}` };
}
