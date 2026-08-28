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

test("trusted package catalog record-review-verify journey verified", async () => {
  const project = await journeyProject();
  try {
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    assert.match(out(recorded), /Recorded 3 candidate\(s\)/);

    const reviewed = run(project, ["review"], "a\na\na\n");
    assert.equal(reviewed.status, 0, out(reviewed));
    assert.match(out(reviewed), /Eligibility basis: catalog/);
    assert.match(out(reviewed), /TRUSTED_PACKAGE_CALL/);
    assert.match(out(reviewed), /Trusted package calls: left-pad-fixture#pad@1\.2\.3/);

    const caseFiles = await jsonFiles(path.join(project, ".replaylock", "cases"));
    assert.equal(caseFiles.length, 3);
    let sawCatalogBasis = 0;
    for (const filename of caseFiles) {
      const artifact = JSON.parse(await readFile(path.join(project, ".replaylock", "cases", filename), "utf8"));
      if (artifact.eligibility.basis === "catalog") {
        sawCatalogBasis += 1;
        assert.deepEqual(artifact.eligibility.packageTrust, [
          { package: "left-pad-fixture", export: "pad", matchedVersion: "1.2.3", unpinned: false },
        ]);
        assert.ok(artifact.eligibility.reasonCodes.includes("TRUSTED_PACKAGE_CALL"));
      }
    }
    assert.equal(sawCatalogBasis, 3, "every candidate in this fixture calls only the trusted export");

    const verified = run(project, ["verify"]);
    assert.equal(verified.status, 0, out(verified));
    assert.match(out(verified), /Verified 3 case\(s\)/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("trusted package catalog version drift and withdrawal revert verify closed", async () => {
  const project = await journeyProject();
  try {
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    assert.equal(run(project, ["review"], "a\na\na\n").status, 0);
    assert.equal(run(project, ["verify"]).status, 0);

    await writeLockfile(project, "2.0.0");
    const drifted = run(project, ["verify"]);
    assert.equal(drifted.status, 2, out(drifted));
    assert.match(out(drifted), /REPLAY_SAFETY_REGRESSION MISSING_ASSUMPTION/);
    assert.match(out(drifted), /trusted-package catalog entry this case relied on no longer matches/);

    await writeLockfile(project, "1.2.3");
    assert.equal(run(project, ["verify"]).status, 0, "restoring the installed version restores trust");

    await writeConfig(project, undefined);
    const withdrawn = run(project, ["verify"]);
    assert.equal(withdrawn.status, 2, out(withdrawn));
    assert.match(out(withdrawn), /REPLAY_SAFETY_REGRESSION MISSING_ASSUMPTION/);
    assert.match(out(withdrawn), /trusted-package catalog entry this case relied on no longer matches/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("trusted package catalog never trusts a locally shadowed binding", async () => {
  const project = await shadowProject();
  try {
    const recorded = record(project);
    assert.equal(recorded.status, 2, out(recorded));
    assert.equal((out(recorded).match(/UNKNOWN_EFFECT/g) ?? []).length, 2, "both the shadowed member-access and shadowed direct-call targets must be blocked");
    assert.match(out(recorded), /Recorded 1 candidate\(s\)/);
    const pending = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    assert.equal(pending.length, 1);
    const candidate = JSON.parse(await readFile(path.join(project, ".replaylock", "observations", "pending", pending[0]), "utf8"));
    assert.equal(candidate.locator.exportName, "trustedNamespaceCall");
    assert.equal(candidate.eligibility.basis, "catalog");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function journeyProject() {
  const project = await baseProject();
  await installLeftPadFixture(project, "1.2.3");
  await writeLockfile(project, "1.2.3");
  await writeConfig(project, { export: "pad", versions: "^1.0.0" });
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { pad } from "left-pad-fixture";
import * as leftPadNamespace from "left-pad-fixture";
import leftPadDefault from "left-pad-fixture";

/** @replaylock capture */
export function namedImportTrust(value: number): string {
  return pad(value, 4);
}

/** @replaylock capture */
export function namespaceImportTrust(value: number): string {
  return leftPadNamespace.pad(value, 4);
}

/** @replaylock capture */
export function defaultImportTrust(value: number): string {
  return leftPadDefault.pad(value, 4);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { defaultImportTrust, namedImportTrust, namespaceImportTrust } from "../src/calculation.js";
test("trust journey", () => {
  expect(namedImportTrust(7)).toBe("0007");
  expect(namespaceImportTrust(8)).toBe("0008");
  expect(defaultImportTrust(9)).toBe("0009");
});
`);
  return project;
}

async function shadowProject() {
  const project = await baseProject();
  await installLeftPadFixture(project, "1.2.3");
  await writeLockfile(project, "1.2.3");
  await writeConfig(project, { export: "pad", versions: "^1.0.0" });
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { pad } from "left-pad-fixture";
import * as leftPad from "left-pad-fixture";

/** @replaylock capture */
export function trustedNamespaceCall(value: number): string {
  return leftPad.pad(value, 4);
}

/** @replaylock capture */
export function shadowedNamespaceCall(leftPad: { pad: (value: number) => string }, value: number): string {
  return leftPad.pad(value);
}

/** @replaylock capture */
export function shadowedNamedCall(pad: (value: number) => string, value: number): string {
  return pad(value);
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { trustedNamespaceCall } from "../src/calculation.js";
test("shadow fixture", () => {
  expect(trustedNamespaceCall(7)).toBe("0007");
});
`);
  return project;
}

async function baseProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-package-catalog-integration-"));
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
    `export function pad(value, length) { return String(value).padStart(length, "0"); }\nexport default { pad };\n`,
  );
}

async function writeLockfile(project, version) {
  await writeFile(path.join(project, "package-lock.json"), JSON.stringify({
    name: "replaylock-core-fixture",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "replaylock-core-fixture" },
      "node_modules/left-pad-fixture": { version },
    },
  }, null, 2));
}

async function writeConfig(project, trustedExport) {
  const body = trustedExport
    ? `defineReplayLock({ trustedPackages: [{ package: "left-pad-fixture", exports: [${JSON.stringify(trustedExport)}] }] })`
    : `defineReplayLock()`;
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock } from "replaylock";
export default ${body};
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
  try { return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort(); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

function out(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
