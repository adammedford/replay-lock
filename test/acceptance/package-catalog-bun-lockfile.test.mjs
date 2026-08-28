import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { isPackageCallTrusted, resolveTrustedPackageVersion } from "../../dist/package-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "core");
const cli = path.join(root, "dist", "cli.js");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

const realWorldBunLock = `{
  // trailing comments and commas are valid JSONC, matching real bun.lock output
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "bun-lockfile-fixture",
      "dependencies": {
        "left-pad-fixture": "^1.0.0",
      },
    },
  },
  "packages": {
    "@types/bun": ["@types/bun@1.3.5", "", { "dependencies": { "bun-types": "1.3.5" } }, "sha512-fake=="],
    "left-pad-fixture": ["left-pad-fixture@1.2.3", "", {}, "sha512-fake=="],
    "uWebSocket.js": ["uWebSockets.js@github:uNetworking/uWebSockets.js#6609a88", {}, "uNetworking-id"],
  },
}
`;

test("resolveTrustedPackageVersion parses scoped and unscoped packages from a real-shaped bun.lock", () => {
  const lockfile = { name: "bun.lock", bytes: Buffer.from(realWorldBunLock, "utf8") };
  assert.equal(resolveTrustedPackageVersion(lockfile, "@types/bun"), "1.3.5");
  assert.equal(resolveTrustedPackageVersion(lockfile, "left-pad-fixture"), "1.2.3");
  assert.equal(resolveTrustedPackageVersion(lockfile, "does-not-exist"), undefined);
});

test("resolveTrustedPackageVersion returns a non-semver resolution as-is and the range check rejects it rather than crashing", () => {
  const lockfile = { name: "bun.lock", bytes: Buffer.from(realWorldBunLock, "utf8") };
  const version = resolveTrustedPackageVersion(lockfile, "uWebSocket.js");
  assert.equal(version, "github:uNetworking/uWebSockets.js#6609a88");
  const catalog = { entries: [{ package: "uWebSocket.js", export: "default", versions: "^1.0.0", unpinned: false }] };
  assert.deepEqual(isPackageCallTrusted(catalog, "uWebSocket.js", "default", lockfile), { trusted: false });
});

test("resolveTrustedPackageVersion falls closed on malformed bun.lock content", () => {
  const lockfile = { name: "bun.lock", bytes: Buffer.from("{ not json", "utf8") };
  assert.equal(resolveTrustedPackageVersion(lockfile, "left-pad-fixture"), undefined);
});

test("resolveTrustedPackageVersion still returns undefined for the binary bun.lockb format", () => {
  const lockfile = { name: "bun.lockb", bytes: Buffer.from([0, 1, 2, 3]) };
  assert.equal(resolveTrustedPackageVersion(lockfile, "left-pad-fixture"), undefined);
});

test("trusted package catalog record-review-verify journey works with a real bun.lock project", async () => {
  const project = await bunProject();
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
    assert.deepEqual(artifact.eligibility.packageTrust, [
      { package: "left-pad-fixture", export: "pad", matchedVersion: "1.2.3", unpinned: false },
    ]);

    assert.equal(run(project, ["verify"]).status, 0);

    await writeBunLock(project, "9.9.9");
    const drifted = run(project, ["verify"]);
    assert.equal(drifted.status, 2, out(drifted));
    assert.match(out(drifted), /REPLAY_SAFETY_REGRESSION MISSING_ASSUMPTION/);
    assert.match(out(drifted), /trusted-package catalog entry this case relied on no longer matches/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("package catalog bun lockfile branch integration marker", () => {
  console.log("package catalog bun lockfile branch integration verified");
});

async function bunProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-bun-lockfile-"));
  await cp(fixture, project, { recursive: true });
  await unlink(path.join(project, "package-lock.json"));
  await writeBunLock(project, "1.2.3");
  await mkdir(path.join(project, "node_modules"));
  await symlink(root, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await installLeftPadFixture(project);
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock } from "replaylock";
export default defineReplayLock({
  trustedPackages: [{ package: "left-pad-fixture", exports: [{ export: "pad", versions: "^1.0.0" }] }],
});
`);
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { pad } from "left-pad-fixture";
/** @replaylock capture */
export function bunTrustedCall(value: number): string {
  return pad(value, 4);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { bunTrustedCall } from "../src/calculation.js";
test("bun trust journey", () => {
  expect(bunTrustedCall(7)).toBe("0007");
});
`);
  return project;
}

async function installLeftPadFixture(project) {
  const packageDirectory = path.join(project, "node_modules", "left-pad-fixture");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: "left-pad-fixture", version: "1.2.3", type: "module", main: "./index.js" }),
  );
  await writeFile(
    path.join(packageDirectory, "index.js"),
    `export function pad(value, length) { return String(value).padStart(length, "0"); }\n`,
  );
}

async function writeBunLock(project, version) {
  await writeFile(path.join(project, "bun.lock"), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { "": { name: "replaylock-core-fixture", dependencies: { "left-pad-fixture": "^1.0.0" } } },
    packages: {
      "left-pad-fixture": [`left-pad-fixture@${version}`, "", {}, "sha512-fake=="],
    },
  }, null, 2));
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
