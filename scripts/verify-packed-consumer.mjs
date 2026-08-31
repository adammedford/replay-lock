import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--skip-build"),
  "Usage: node scripts/verify-packed-consumer.mjs [--skip-build]",
);
assert.equal(process.versions.node.split(".")[0], "22", "packed verification must use Node 22");

const npmCli = await resolveNpmCli();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert.equal(`npm@${runNpm(["--version"], root).trim()}`, manifest.packageManager, "use the repository's pinned npm version");
if (arguments_.length === 0) runNpm(["run", "build", "--silent"], root);

// Spaces in both paths keep subprocess argument handling part of the smoke test.
const temporary = await mkdtemp(path.join(os.tmpdir(), "replaylock packed consumer "));
try {
  const tarballs = path.join(temporary, "packed artifact");
  const consumer = path.join(temporary, "clean consumer");
  await mkdir(tarballs);
  await mkdir(consumer);
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", tarballs], root));
  assert.equal(packed.length, 1, "npm pack must produce exactly one package");
  const [artifact] = packed;
  const packedPaths = artifact.files.map((entry) => entry.path);
  assertPackedFiles(packedPaths);
  // These controls prove the same shipping contract rejects both missing legal
  // material and a newly leaked source file, not just the current happy path.
  assert.throws(() => assertPackedFiles(packedPaths.filter((name) => name !== "LICENSE")), /LICENSE must ship/);
  assert.throws(() => assertPackedFiles([...packedPaths, "src/accidental-source.ts"]), /must not ship/);
  assert.equal(artifact.filename, path.basename(artifact.filename), "pack filename must stay in the temporary directory");
  assert.ok(artifact.filename.endsWith(".tgz"), "verification must install a real tarball");
  const tarball = path.join(tarballs, artifact.filename);
  assert.ok((await lstat(tarball)).isFile(), "npm pack must create the tarball it reports");

  await writeFile(path.join(consumer, "package.json"), JSON.stringify({
    name: "replaylock-packed-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
  }, null, 2) + "\n");
  // Inherit npm's configured cache (warmed by CI's npm ci). Do not cache
  // node_modules or bypass the actual dependency installation with symlinks.
  runNpm(["install", tarball, "--prefer-offline", "--no-audit", "--no-fund"], consumer);
  const installed = path.join(consumer, "node_modules", "replaylock");
  assert.equal((await lstat(installed)).isSymbolicLink(), false, "the consumer must install extracted package files");
  assert.notEqual(await realpath(installed), await realpath(root), "the consumer must not resolve the checkout");
  const installedManifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.deepEqual(installedManifest, manifest, "the installed manifest must be the packed package manifest");
  assert.equal(installedManifest.license, "MIT");
  assert.equal(installedManifest.private, true, "GitHub publication must not enable npm publication");
  assert.equal(installedManifest.repository.url, "git+https://github.com/adammedford/replay-lock.git");
  assert.equal(installedManifest.bugs.url, "https://github.com/adammedford/replay-lock/issues");
  assert.equal(installedManifest.homepage, "https://github.com/adammedford/replay-lock#readme");
  assert.match(await readFile(path.join(installed, "LICENSE"), "utf8"), /^MIT License\r?\n/);
  for (const target of exportTargets(installedManifest.exports)) {
    assert.ok((await lstat(path.join(installed, packagePath(target)))).isFile(), `${target} must resolve to an installed file`);
  }

  const cli = path.join(installed, packagePath(installedManifest.bin.replaylock));
  assert.ok((await readFile(cli, "utf8")).startsWith("#!/usr/bin/env node"), "installed CLI must retain its executable shebang");
  const shim = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "replaylock.cmd" : "replaylock");
  await access(shim, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  if (process.platform !== "win32") await access(cli, constants.X_OK);

  const imports = runNode(["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import { dirname, join } from "node:path";
    import { REPLAYLOCK_VERSION, defineReplayLock, defineValueAdapter } from "replaylock";
    import { replaylock } from "replaylock/vite";
    import { observeCall } from "replaylock/vite/runtime";
    assert.equal(REPLAYLOCK_VERSION, ${JSON.stringify(manifest.version)});
    assert.equal(typeof defineReplayLock, "function");
    assert.equal(typeof defineValueAdapter, "function");
    assert.equal(replaylock().name, "replaylock");
    assert.equal(typeof observeCall, "function");
    const require = createRequire(import.meta.resolve("replaylock"));
    console.log(join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"));
  `], consumer, { stdoutOnly: true });
  const vitestCli = imports.trim();
  assert.ok(path.isAbsolute(vitestCli), "the installed package must resolve its own Vitest CLI");
  const installedRelative = path.relative(await realpath(consumer), await realpath(vitestCli));
  assert.ok(!installedRelative.startsWith("..") && !path.isAbsolute(installedRelative), "Vitest must come from the clean installation");

  await mkdir(path.join(consumer, "src"));
  await mkdir(path.join(consumer, "test"));
  await writeFile(path.join(consumer, "src", "calculation.ts"), `/** @replaylock capture */
export function calculate(left: number, right: number): number {
  return left + right;
}
`);
  await writeFile(path.join(consumer, "test", "calculation.test.ts"), `import { expect, test } from "vitest";
import { calculate } from "../src/calculation.js";

test("the consumer naturally calls its captured function", () => {
  expect(calculate(2, 3)).toBe(5);
});
`);
  await writeFile(path.join(consumer, "vitest.config.ts"), `import { replaylock } from "replaylock/vite";

export default {
  plugins: [replaylock()],
  test: { include: ["test/**/*.test.ts"] },
};
`);

  // Exercise npm's installed command shim once, including npm.cmd platforms.
  // Subsequent argv-only node launches keep record's nested command shell-free.
  runNpm(["exec", "--offline", "--no", "--", "replaylock", "scan"], consumer);
  const recorded = runCli(cli, ["record", "--", process.execPath, vitestCli, "run", "--config", "vitest.config.ts"], consumer);
  assert.match(recorded, /Recorded 1 candidate\(s\)/);

  const observations = await completedObservations(consumer);
  assert.equal(observations.length, 1, "record must observe exactly one natural call, not synthesize calls");
  assert.deepEqual(observations[0].arguments, [2, 3]);
  assert.deepEqual(observations[0].completion, { kind: "return", value: 5 });
  const pending = path.join(consumer, ".replaylock", "observations", "pending");
  const cases = path.join(consumer, ".replaylock", "cases");
  const candidates = await jsonFiles(pending);
  assert.equal(candidates.length, 1);
  const candidate = JSON.parse(await readFile(path.join(pending, candidates[0]), "utf8"));
  const expectedArguments = { kind: "array", items: [{ kind: "number", value: 2 }, { kind: "number", value: 3 }] };
  const expectedCompletion = { kind: "return", value: { kind: "number", value: 5 } };
  assert.deepEqual(candidate.locator, { module: "src/calculation.ts", exportName: "calculate" });
  assert.deepEqual(candidate.arguments, expectedArguments);
  assert.deepEqual(candidate.completion, expectedCompletion);
  assert.equal(candidate.occurrences, 1);
  assert.equal(candidate.eligibility.basis, "automatic");
  assert.equal(candidate.eligibility.verdict, "likely-safe");

  // This scripted decision is restricted to the disposable, known-literal
  // fixture above. Production observations and repository cases are never read
  // or accepted by this script. First prove review can leave the case pending.
  const skipped = runCli(cli, ["review"], consumer, { input: "skip\n" });
  assert.ok(skipped.includes(`Canonical input: ${JSON.stringify(expectedArguments)}`));
  assert.ok(skipped.includes(`Canonical completion: ${JSON.stringify(expectedCompletion)}`));
  assert.equal((await jsonFiles(cases)).length, 0, "record and skipped review must not accept a case");
  assert.deepEqual(await jsonFiles(pending), candidates);
  runCli(cli, ["review"], consumer, { input: "accept\n" });
  const accepted = await jsonFiles(cases);
  assert.equal(accepted.length, 1, "one explicit review must create exactly one case");
  assert.equal((await jsonFiles(pending)).length, 0);
  const casePath = path.join(cases, accepted[0]);
  const originalBytes = await readFile(casePath);
  const acceptedCase = JSON.parse(originalBytes.toString("utf8"));
  assert.deepEqual(acceptedCase.locator, candidate.locator);
  assert.equal(acceptedCase.comparison, "exact");
  assert.deepEqual(acceptedCase.arguments, expectedArguments);
  assert.deepEqual(acceptedCase.completion, expectedCompletion);
  assert.match(runCli(cli, ["verify"], consumer), /Verified 1 case\(s\)/);
  assert.deepEqual(await readFile(casePath), originalBytes, "successful verify must not update the accepted case");

  const sourcePath = path.join(consumer, "src", "calculation.ts");
  const source = await readFile(sourcePath, "utf8");
  assert.ok(source.includes("return left + right;"));
  await writeFile(sourcePath, source.replace("return left + right;", "return left * right;"));
  const drift = runCli(cli, ["verify"], consumer, { status: 1 });
  assert.match(drift, /OUTPUT_MISMATCH/, "source mutation must fail for behavioral drift, not a setup failure");
  assert.deepEqual(await jsonFiles(cases), accepted);
  assert.deepEqual(await readFile(casePath), originalBytes, "failing verify must not update the accepted case");
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
console.log("packed consumer verified");

function assertPackedFiles(names) {
  const paths = new Set(names);
  assert.equal(paths.size, names.length, "packed paths must be unique");
  const required = [
    "package.json", "README.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md",
    "docs/value-adapters.md", "docs/trusted-packages.md", "docs/troubleshooting.md",
    "docs/pilot-checklist.md", "docs/ci.md",
    "examples/github-actions/replaylock-verify.yml", "examples/github-actions/report-verify-exit.sh",
    ...exportTargets(manifest.exports).map(packagePath), packagePath(manifest.bin.replaylock),
  ];
  for (const name of required) assert.ok(paths.has(name), `${name} must ship in the package`);
  const privateRoots = new Set(["src", "test", "tests", "scripts", ".github", ".unlazy", ".replaylock"]);
  for (const name of names) {
    const privateFile = name === "GATES.md" || /^tsconfig(?:\.[^/]*)?\.json$/.test(name);
    assert.ok(!privateRoots.has(name.split("/")[0]) && !privateFile, `${name} must not ship in the package`);
    assert.ok(!name.split("/").includes("..") && !path.isAbsolute(name), "packed paths must stay inside the package");
  }
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (value === null) return [];
  assert.ok(value && typeof value === "object", "exports must contain package targets");
  return Object.values(value).flatMap(exportTargets);
}

function packagePath(target) {
  assert.ok(target.startsWith("./") && !target.split("/").includes(".."), "package targets must be relative and contained");
  return target.slice(2);
}

async function resolveNpmCli() {
  // Honor the invoking npm first, then PATH order, then Node's bundled npm.
  // Launch its JavaScript entry with node instead of spawning npm.cmd: Node's
  // direct Windows spawn rejects .cmd files, and shell concatenation is unsafe.
  const directories = [...(process.env.PATH ?? "").split(path.delimiter), path.dirname(process.execPath)];
  const candidates = [process.env.npm_execpath];
  for (const directory of directories.filter(Boolean)) {
    candidates.push(
      path.join(directory, "npm"),
      path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      path.resolve(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );
  }
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const resolved = await realpath(candidate);
      if (path.basename(resolved) === "npm-cli.js" && (await lstat(resolved)).isFile()) return resolved;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error("Cannot locate npm-cli.js; run with npm run or add the Node/npm installation to PATH");
}

function runNpm(args, cwd) {
  return runNode([npmCli, ...args], cwd, { timeout: 180_000, stdoutOnly: true });
}

function runCli(cli, args, cwd, options = {}) {
  return runNode([cli, ...args], cwd, options);
}

function runNode(args, cwd, { input, status = 0, timeout = 60_000, stdoutOnly = false } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", input, timeout, maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.ifError(result.error);
  assert.equal(result.status, status, `command failed (${args.slice(0, 2).join(" ")}):\n${output}`);
  return stdoutOnly ? result.stdout : output;
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function completedObservations(consumer) {
  const sessions = path.join(consumer, ".replaylock", "observations", "sessions");
  const observations = [];
  for (const session of await readdir(sessions)) {
    const workers = path.join(sessions, session, "workers");
    for (const worker of await readdir(workers)) {
      const chunks = path.join(workers, worker, "chunks");
      for (const chunk of (await readdir(chunks)).filter((name) => name.endsWith(".complete.json"))) {
        observations.push(JSON.parse(await readFile(path.join(chunks, chunk), "utf8")).record);
      }
    }
  }
  return observations;
}
