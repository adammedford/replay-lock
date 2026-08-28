import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { defineReplayLock, TrustedPackageConfigurationError } from "../../dist/adapters.js";
import {
  emptyPackageCatalog,
  isPackageCallTrusted,
  resolveTrustedPackageVersion,
  validateTrustedPackages,
} from "../../dist/package-catalog.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

test("trusted package catalog structural validation verified", () => {
  assert.throws(
    () => defineReplayLock({ trustedPackages: "not-an-array" }),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_DEFINITION_INVALID",
  );
  assert.throws(
    () => validateTrustedPackages({
      valueAdapters: [],
      trustedPackages: [new Proxy({ package: "lodash", exports: [] }, {})],
    }),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_DEFINITION_INVALID",
  );
  assert.throws(
    () => validateTrustedPackages({
      valueAdapters: [],
      trustedPackages: [{ package: "lodash", exports: [{}] }],
    }),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_DEFINITION_INVALID",
  );
  assert.throws(
    () => validateTrustedPackages({
      valueAdapters: [],
      trustedPackages: [{ package: "lodash", exports: [{ export: "get", unpinned: "yes" }] }],
    }),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_DEFINITION_INVALID",
  );
});

test("trusted package catalog duplicate and semver-range validation verified", () => {
  const duplicate = defineReplayLock({
    trustedPackages: [{
      package: "lodash",
      exports: [
        { export: "get", versions: "^4.17.0" },
        { export: "get", versions: "^4.17.0" },
      ],
    }],
  });
  assert.throws(
    () => validateTrustedPackages(duplicate),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_ID_DUPLICATE",
  );

  const missingRange = defineReplayLock({
    trustedPackages: [{ package: "lodash", exports: [{ export: "get" }] }],
  });
  assert.throws(
    () => validateTrustedPackages(missingRange),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
  );

  const invalidRange = defineReplayLock({
    trustedPackages: [{ package: "lodash", exports: [{ export: "get", versions: "not-a-range" }] }],
  });
  assert.throws(
    () => validateTrustedPackages(invalidRange),
    (error) => error instanceof TrustedPackageConfigurationError && error.code === "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
  );
});

test("trusted package catalog accepts unpinned, wildcard, and versioned entries verified", () => {
  const config = defineReplayLock({
    trustedPackages: [{
      package: "lodash",
      exports: [
        { export: "get", versions: "^4.17.0" },
        { export: "isEqual", unpinned: true },
        { export: "clone", versions: "*" },
      ],
    }],
  });
  const catalog = validateTrustedPackages(config);
  assert.deepEqual(
    [...catalog.entries].sort((a, b) => a.export.localeCompare(b.export)),
    [
      { package: "lodash", export: "clone", unpinned: true },
      { package: "lodash", export: "get", versions: "^4.17.0", unpinned: false },
      { package: "lodash", export: "isEqual", unpinned: true },
    ],
  );
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.entries));
});

test("resolveTrustedPackageVersion npm lockfile parsing verified", () => {
  const packagesShape = {
    name: "package-lock.json",
    bytes: Buffer.from(JSON.stringify({ packages: { "node_modules/lodash": { version: "4.17.21" } } })),
  };
  assert.equal(resolveTrustedPackageVersion(packagesShape, "lodash"), "4.17.21");

  const legacyShape = {
    name: "package-lock.json",
    bytes: Buffer.from(JSON.stringify({ dependencies: { lodash: { version: "4.17.20" } } })),
  };
  assert.equal(resolveTrustedPackageVersion(legacyShape, "lodash"), "4.17.20");

  const missing = {
    name: "package-lock.json",
    bytes: Buffer.from(JSON.stringify({ packages: {} })),
  };
  assert.equal(resolveTrustedPackageVersion(missing, "lodash"), undefined);

  for (const name of ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
    assert.equal(resolveTrustedPackageVersion({ name, bytes: Buffer.from("irrelevant") }, "lodash"), undefined);
  }
});

test("isPackageCallTrusted verified", () => {
  const catalog = validateTrustedPackages(defineReplayLock({
    trustedPackages: [{
      package: "lodash",
      exports: [
        { export: "get", versions: "^4.17.0" },
        { export: "isEqual", unpinned: true },
      ],
    }],
  }));
  const inRange = {
    name: "package-lock.json",
    bytes: Buffer.from(JSON.stringify({ packages: { "node_modules/lodash": { version: "4.17.21" } } })),
  };
  const outOfRange = {
    name: "package-lock.json",
    bytes: Buffer.from(JSON.stringify({ packages: { "node_modules/lodash": { version: "5.0.0" } } })),
  };
  assert.deepEqual(isPackageCallTrusted(catalog, "lodash", "get", inRange), { trusted: true, matchedVersion: "4.17.21", unpinned: false });
  assert.deepEqual(isPackageCallTrusted(catalog, "lodash", "isEqual", undefined), { trusted: true, unpinned: true });
  assert.deepEqual(isPackageCallTrusted(catalog, "lodash", "template", inRange), { trusted: false });
  assert.deepEqual(isPackageCallTrusted(catalog, "lodash", "get", outOfRange), { trusted: false });
  assert.deepEqual(isPackageCallTrusted(catalog, "lodash", "get", undefined), { trusted: false });
  assert.deepEqual(isPackageCallTrusted(emptyPackageCatalog, "lodash", "get", inRange), { trusted: false });
});

test("trusted package catalog fails record closed on malformed configuration verified", async () => {
  for (const { configBody, detailCode } of [
    {
      configBody: `trustedPackages: [{ package: "lodash", exports: [{ export: "get" }] }]`,
      detailCode: "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
    },
    {
      configBody: `trustedPackages: [{ package: "lodash", exports: [{ export: "get", versions: "^4.17.0" }, { export: "get", versions: "^4.17.0" }] }]`,
      detailCode: "TRUSTED_PACKAGE_ID_DUPLICATE",
    },
    {
      configBody: `trustedPackages: [{ package: "lodash", exports: [{}] }]`,
      detailCode: "TRUSTED_PACKAGE_DEFINITION_INVALID",
    },
  ]) {
    const project = await makeProject(configBody);
    try {
      const result = runRecord(project);
      assert.equal(result.status, 2, output(result));
      assert.match(output(result), new RegExp(`TRUSTED_PACKAGE_INVALID TRUSTED_PACKAGE_REGISTRY_FAILED ${detailCode}`));
      assert.equal(await pathExists(path.join(project, "marker.json")), false, "wrapped command must never run when the catalog is invalid");
      assert.equal((await entriesOrEmpty(path.join(project, ".replaylock", "observations", "pending"))).length, 0);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

async function makeProject(configBody) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-package-catalog-validation-"));
  await cp(fixtureRoot, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(repositoryRoot, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { writeFileSync } from "node:fs";
import { calculate } from "../src/calculation.js";
test("marks that the wrapped command ran", () => {
  writeFileSync("marker.json", JSON.stringify({ ran: true }));
  expect(calculate(2, 3)).toBe(5);
});
`);
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock } from "replaylock";
export default defineReplayLock({ ${configBody} });
`);
  return project;
}

function runRecord(project) {
  return runCli(project, ["record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"]);
}

function runCli(project, arguments_, input, timeout = 30_000) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: project, encoding: "utf8", env: environment, input, timeout,
  });
}

async function entriesOrEmpty(directory) {
  try { return (await readdir(directory)).sort(); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

async function pathExists(target) {
  try { await stat(target); return true; }
  catch { return false; }
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
