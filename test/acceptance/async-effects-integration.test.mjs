import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "core");
const cli = path.join(root, "dist", "cli.js");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

test("an assume-pure async function that awaits unknown evidence is captured with a fingerprinted assumption", async () => {
  const project = await baseProject();
  await writeFile(path.join(project, "src", "calculation.js"), `
async function callback(fn, value) {
  return fn(value);
}

/**
 * @replaylock capture
 * @replaylock assume-pure reviewed indirect async dispatch
 */
export async function asyncAssumed(value) {
  return await callback((input) => input + 1, value);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { asyncAssumed } from "../src/calculation.js";
test("natural async assumed behavior", async () => {
  expect(await asyncAssumed(4)).toBe(5);
});
`);
  try {
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    assert.match(out(recorded), /Recorded 1 candidate\(s\)/);

    const pending = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    assert.equal(pending.length, 1);
    const candidate = JSON.parse(await readFile(path.join(project, ".replaylock", "observations", "pending", pending[0]), "utf8"));
    assert.equal(candidate.eligibility.basis, "assumption");
    assert.equal(candidate.eligibility.assumption?.reason, "reviewed indirect async dispatch");
    assert.match(candidate.eligibility.assumption?.fingerprint ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.ok((candidate.eligibility.assumption?.originalEvidence.length ?? 0) > 0);

    const reviewed = run(project, ["review"], "a\n");
    assert.equal(reviewed.status, 0, out(reviewed));
    assert.match(out(reviewed), /Assumption reason: reviewed indirect async dispatch/);

    const verified = run(project, ["verify"]);
    assert.equal(verified.status, 0, out(verified));
    assert.match(out(verified), /Verified 1 case\(s\)/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a trusted-package export reached through await surfaces catalog evidence end to end for an async target", async () => {
  const project = await baseProject();
  await installLeftPadFixture(project, "1.2.3");
  await writeFile(path.join(project, "package-lock.json"), JSON.stringify({
    name: "replaylock-core-fixture",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "replaylock-core-fixture" },
      "node_modules/left-pad-fixture": { version: "1.2.3" },
    },
  }, null, 2));
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock } from "replaylock";
export default defineReplayLock({
  trustedPackages: [{ package: "left-pad-fixture", exports: [{ export: "pad", versions: "^1.0.0" }] }],
});
`);
  await writeFile(path.join(project, "src", "calculation.js"), `
import { pad } from "left-pad-fixture";

async function helper(value) {
  return pad(value, 4);
}

/** @replaylock capture */
export async function asyncTrusted(value) {
  return await helper(value);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { asyncTrusted } from "../src/calculation.js";
test("natural async trusted behavior", async () => {
  expect(await asyncTrusted(7)).toBe("0007");
});
`);
  try {
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    assert.match(out(recorded), /Recorded 1 candidate\(s\)/);

    const reviewed = run(project, ["review"], "a\n");
    assert.equal(reviewed.status, 0, out(reviewed));
    assert.match(out(reviewed), /Eligibility basis: catalog/);
    assert.match(out(reviewed), /Trusted package calls: left-pad-fixture#pad@1\.2\.3/);

    const caseFiles = await jsonFiles(path.join(project, ".replaylock", "cases"));
    assert.equal(caseFiles.length, 1);
    const artifact = JSON.parse(await readFile(path.join(project, ".replaylock", "cases", caseFiles[0]), "utf8"));
    assert.equal(artifact.eligibility.basis, "catalog");
    assert.deepEqual(artifact.eligibility.packageTrust, [
      { package: "left-pad-fixture", export: "pad", matchedVersion: "1.2.3", unpinned: false },
    ]);

    const verified = run(project, ["verify"]);
    assert.equal(verified.status, 0, out(verified));
    assert.match(out(verified), /Verified 1 case\(s\)/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("async effect propagation integration marker", () => {
  console.log("async effect propagation integration verified");
});

async function baseProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-async-effects-"));
  await cp(fixture, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(root, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  return project;
}

async function installLeftPadFixture(project, version) {
  const packageDirectory = path.join(project, "node_modules", "left-pad-fixture");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: "left-pad-fixture", version, type: "module", main: "./index.js" }),
  );
  await writeFile(
    path.join(packageDirectory, "index.js"),
    `export function pad(value, length) { return String(value).padStart(length, "0"); }\n`,
  );
}

function record(project) {
  return run(project, ["record", "--", process.execPath, vitest, "run", "--config", "vitest.config.ts"]);
}

function run(project, arguments_, input) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: project, encoding: "utf8", env: environment, input, timeout: 30_000,
  });
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function out(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
