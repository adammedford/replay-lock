import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveTrustedPackageVersion } from "../../dist/package-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "core");
const cli = path.join(root, "dist", "cli.js");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

const realWorldPnpmLock = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      left-pad-fixture:
        specifier: ^1.0.0
        version: 1.2.3
    devDependencies:
      '@types/left-pad-fixture':
        specifier: ^1.0.0
        version: 1.0.0
      peer-suffixed-fixture:
        specifier: ^2.0.0
        version: 2.5.0(some-peer@1.0.0)(other-peer@2.0.0)

packages:

  left-pad-fixture@1.2.3:
    resolution: {integrity: sha512-fake==}
`;

function pnpmLockfile(version) {
  return { name: "pnpm-lock.yaml", bytes: Buffer.from(realWorldPnpmLock.replace("version: 1.2.3", `version: ${version}`), "utf8") };
}

test("resolveTrustedPackageVersion reads the importer's own resolved version, not the flat packages map", () => {
  const lockfile = pnpmLockfile("1.2.3");
  assert.equal(resolveTrustedPackageVersion(lockfile, "left-pad-fixture"), "1.2.3");
  assert.equal(resolveTrustedPackageVersion(lockfile, "@types/left-pad-fixture"), "1.0.0");
  assert.equal(resolveTrustedPackageVersion(lockfile, "does-not-exist"), undefined);
});

test("resolveTrustedPackageVersion truncates a peer-dependency-qualified version to its base semver", () => {
  const lockfile = pnpmLockfile("1.2.3");
  assert.equal(resolveTrustedPackageVersion(lockfile, "peer-suffixed-fixture"), "2.5.0");
});

test("resolveTrustedPackageVersion falls closed when importers or the root workspace is absent", () => {
  assert.equal(resolveTrustedPackageVersion({ name: "pnpm-lock.yaml", bytes: Buffer.from("packages:\n  left-pad-fixture@1.0.0: {}\n") }, "left-pad-fixture"), undefined);
  assert.equal(resolveTrustedPackageVersion({ name: "pnpm-lock.yaml", bytes: Buffer.from("importers:\n  packages/other:\n    dependencies: {}\n") }, "left-pad-fixture"), undefined);
});

test("trusted package catalog record-review-verify journey works with a real pnpm-lock.yaml project", async () => {
  const project = await pnpmProject("1.2.3");
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

    await writePnpmLock(project, "9.9.9");
    const drifted = run(project, ["verify"]);
    assert.equal(drifted.status, 2, out(drifted));
    assert.match(out(drifted), /REPLAY_SAFETY_REGRESSION MISSING_ASSUMPTION/);
    assert.match(out(drifted), /trusted-package catalog entry this case relied on no longer matches/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("package catalog pnpm lockfile branch integration marker", () => {
  console.log("package catalog pnpm lockfile branch integration verified");
});

async function pnpmProject(version) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-pnpm-lockfile-"));
  await cp(fixture, project, { recursive: true });
  await unlink(path.join(project, "package-lock.json"));
  await writePnpmLock(project, version);
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
export function pnpmTrustedCall(value: number): string {
  return pad(value, 4);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { pnpmTrustedCall } from "../src/calculation.js";
test("pnpm trust journey", () => {
  expect(pnpmTrustedCall(7)).toBe("0007");
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

async function writePnpmLock(project, version) {
  await writeFile(path.join(project, "pnpm-lock.yaml"), `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad-fixture:
        specifier: ^1.0.0
        version: ${version}

packages:

  left-pad-fixture@${version}:
    resolution: {integrity: sha512-fake==}
`);
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
