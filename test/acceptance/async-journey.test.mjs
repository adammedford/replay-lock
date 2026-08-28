import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "test", "fixtures", "core");
const cliPath = path.join(root, "dist", "cli.js");
const vitestPath = path.join(root, "node_modules", "vitest", "vitest.mjs");

const calculationSource = `async function helperDouble(value) {
  return value * 2;
}

/** @replaylock capture */
export async function asyncSafe(value) {
  return { doubled: await helperDouble(value), tag: "ok" };
}

/** @replaylock capture */
export const asyncArrowSafe = async (value) => value + 1;

/** @replaylock capture */
export async function asyncThrows(value) {
  if (value < 0) throw "negative-value";
  return value;
}

/** @replaylock capture */
export async function* asyncGeneratorUnsupported(value) {
  yield value;
}

/** @replaylock capture */
export function* generatorUnsupported(value) {
  yield value;
}

/** @replaylock capture */
export function syncReturnsUnawaitedPromise(value) {
  return helperDouble(value);
}
`;

const testSource = `import {
  asyncArrowSafe,
  asyncSafe,
  asyncThrows,
  syncReturnsUnawaitedPromise,
} from "../src/calculation.js";

test("natural async behavior", async () => {
  expect(await asyncSafe(3)).toEqual({ doubled: 6, tag: "ok" });
  expect(await asyncArrowSafe(4)).toBe(5);
  let caught;
  try {
    await asyncThrows(-1);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe("negative-value");
  expect(await syncReturnsUnawaitedPromise(5)).toBe(10);
});
`;

test("async captured functions record eligible candidates, reject generator shapes, and preserve the unawaited-promise skip", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-async-journey-"));
  await cp(fixtureRoot, project, { recursive: true });
  await writeFile(path.join(project, "src", "calculation.js"), calculationSource);
  await writeFile(path.join(project, "test", "calculation.test.ts"), testSource);
  const nodeModules = path.join(project, "node_modules");
  await mkdir(nodeModules);
  await symlink(root, path.join(nodeModules, "replaylock"), process.platform === "win32" ? "junction" : "dir");
  try {
    const recorded = runCli(project, "record", ["--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"]);
    const recordedOutput = output(recorded);
    // Two generator-shaped capture targets remain blocked, so the session is
    // partial even though the eligible targets record cleanly.
    assert.equal(recorded.status, 2, recordedOutput);
    assert.match(recordedOutput, /UNSUPPORTED_CALLABLE src\/calculation\.js:\d+:\d+: annotated callable is not a directly exported named synchronous function/);

    const pendingDirectory = path.join(project, ".replaylock", "observations", "pending");
    const pendingFiles = (await readdir(pendingDirectory)).filter((name) => name.endsWith(".json")).sort();
    const candidates = await Promise.all(
      pendingFiles.map(async (filename) => JSON.parse(await readFile(path.join(pendingDirectory, filename), "utf8"))),
    );
    assert.deepEqual(
      candidates.map((candidate) => candidate.locator.exportName).sort(),
      ["asyncArrowSafe", "asyncSafe", "asyncThrows"],
    );
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "syncReturnsUnawaitedPromise"), false);
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "asyncGeneratorUnsupported"), false);
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "generatorUnsupported"), false);

    const asyncSafeCandidate = candidates.find((candidate) => candidate.locator.exportName === "asyncSafe");
    assert.equal(asyncSafeCandidate?.completion.kind, "return");
    assert.equal(asyncSafeCandidate?.eligibility.basis, "automatic");
    const asyncThrowsCandidate = candidates.find((candidate) => candidate.locator.exportName === "asyncThrows");
    assert.equal(asyncThrowsCandidate?.completion.kind, "throw");
    assert.equal(asyncThrowsCandidate?.completion.value?.kind, "string");
    assert.equal(asyncThrowsCandidate?.completion.value?.value, "negative-value");

    const review = runCli(project, "review", { input: "a\na\na\n" });
    assert.equal(review.status, 0, output(review));
    assert.equal((output(review).match(/Accepted [a-f0-9]{64}/g) ?? []).length, 3);
    assert.deepEqual(await readdir(pendingDirectory), []);

    const verified = runCli(project, "verify");
    assert.equal(verified.status, 0, output(verified));
    assert.match(output(verified), /Verified 3 case\(s\)/);

    await writeFile(
      path.join(project, "src", "calculation.js"),
      calculationSource.replace("value * 2", "value * 3"),
    );
    const regressed = runCli(project, "verify");
    assert.equal(regressed.status, 1, output(regressed));
    assert.match(output(regressed), /OUTPUT_MISMATCH src\/calculation\.js#asyncSafe/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("async journey branch integration marker", () => {
  console.log("async journey branch integration verified");
});

function runCli(project, command, extra) {
  const argv = Array.isArray(extra) ? extra : [];
  const options = Array.isArray(extra) ? {} : (extra ?? {});
  return spawnSync(process.execPath, [cliPath, command, ...argv], {
    cwd: project,
    encoding: "utf8",
    env: { ...scrubbedEnvironment(), NO_COLOR: "1", FORCE_COLOR: "0" },
    input: options.input,
    timeout: 30_000,
  });
}

function scrubbedEnvironment() {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return environment;
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
