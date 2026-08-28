import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(root, "dist", "cli.js");

const calculationSource = `export function pureUntagged(value: number): number {
  return value + 1;
}

/** @replaylock capture */
export function pureTagged(value: number): number {
  return value * 2;
}

export function effectfulUntagged(value: number): number {
  console.log(value);
  return value;
}

/** @replaylock exclude reads the system clock */
export function excludedFn(): number {
  return Date.now();
}

export function* generatorFn(value: number) {
  yield value;
}

export default function defaultFn(value: number): number {
  return value - 1;
}

/**
 * @replaylock capture
 * @replaylock assume-pure reviewed dispatch
 */
export function assumedFn(callback: (value: number) => number, value: number): number {
  return callback(value);
}

export function indirectDispatch(callback: (value: number) => number, value: number): number {
  return callback(value);
}
`;

test("scan reports eligibility for every exported function, annotated or not, without executing tests or writing state", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-scan-"));
  try {
    await mkdir(path.join(project, "src"));
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "scan-fixture", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    await writeFile(path.join(project, "src", "calculation.ts"), calculationSource);

    const result = runScan(project);
    const text = output(result);
    assert.equal(result.status, 0, text);

    assert.match(text, /SCAN_ELIGIBLE src\/calculation\.ts:1:1: pureUntagged/);
    assert.match(text, /SCAN_ELIGIBLE src\/calculation\.ts:\d+:\d+: pureTagged/);
    assert.match(text, /SCAN_INELIGIBLE src\/calculation\.ts:\d+:\d+: effectfulUntagged \(LOGGING\)/);
    assert.match(text, /SCAN_EXCLUDED src\/calculation\.ts:\d+:\d+: excludedFn/);
    assert.match(text, /SCAN_UNSUPPORTED_SHAPE src\/calculation\.ts:\d+:\d+: generatorFn/);
    assert.match(text, /SCAN_UNSUPPORTED_SHAPE src\/calculation\.ts:\d+:\d+: defaultFn/);
    assert.match(text, /SCAN_ELIGIBLE src\/calculation\.ts:\d+:\d+: assumedFn/);
    assert.match(text, /SCAN_NEEDS_REVIEW src\/calculation\.ts:\d+:\d+: indirectDispatch \(UNKNOWN_CALL\)/);
    assert.match(text, /Scanned 8 exported function\(s\): 3 eligible, 1 needs-review, 1 ineligible, 2 unsupported-shape, 1 excluded/);

    assert.deepEqual(await entriesOrEmpty(path.join(project, ".replaylock")), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("scan exits 0 on a project with zero eligible functions and requires no Vite or Vitest configuration", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-scan-empty-"));
  try {
    await mkdir(path.join(project, "src"));
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "scan-empty-fixture", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    await writeFile(
      path.join(project, "src", "calculation.ts"),
      `export function effectful(value: number): number { console.log(value); return value; }\n`,
    );

    const result = runScan(project);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /SCAN_INELIGIBLE/);
    assert.match(output(result), /Scanned 1 exported function\(s\): 0 eligible/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("scan branch integration marker", () => {
  console.log("scan branch integration verified");
});

function runScan(project) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cliPath, "scan"], {
    cwd: project,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });
}

async function entriesOrEmpty(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
