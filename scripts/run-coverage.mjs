import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedSources } from "./coverage/inputs.mjs";

assert.equal(process.argv.length, 2, "Usage: npm run coverage (no additional arguments)");
assert.equal(process.versions.node.split(".")[0], "22", "coverage must use supported Node 22");
const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const installed = JSON.parse(await readFile(path.join(root, "node_modules", "c8", "package.json"), "utf8"));
const installedVitest = JSON.parse(await readFile(path.join(root, "node_modules", "vitest", "package.json"), "utf8"));
assert.equal(manifest.devDependencies.c8, "12.0.0", "c8 must remain exactly pinned");
assert.equal(lock.packages["node_modules/c8"].version, "12.0.0", "c8 lock must match");
assert.equal(installed.version, "12.0.0", "installed c8 must match");
assert.equal(manifest.dependencies.vitest, "4.1.11", "coverage worker protocol requires pinned Vitest 4.1.11");
assert.equal(lock.packages["node_modules/vitest"].version, "4.1.11", "Vitest lock must match the coverage protocol");
assert.equal(installedVitest.version, "4.1.11", "installed Vitest must match the coverage protocol");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && path.isAbsolute(npmCli) && path.basename(npmCli) === "npm-cli.js", "Run coverage through npm run coverage");
const before = await sourceDigest();
const temporary = await mkdtemp(path.join(os.tmpdir(), "replaylock-coverage-"));
const raw = path.join(temporary, "raw");
const started = Date.now();
try {
  await mkdir(raw);
  await mkdir(path.join(root, "coverage"), { recursive: true });
  const reports = await mkdtemp(path.join(root, "coverage", "run-"));
  // Native V8 collection is inherited by the complete npm verification tree:
  // acceptance parents, CLI children, Vite coordinators and Vitest workers.
  console.log("Collecting full npm verification with descendant V8 coverage");
  const preload = pathToFileURL(path.join(root, "scripts", "coverage", "flush-workers.mjs")).href;
  const verification = run([npmCli, "run", "verify", "--", "--concurrency=2", "--reporter=spec"], {
    ...process.env, NODE_V8_COVERAGE: raw,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
  });
  assert.equal(verification.status, 0, "full verification failed; coverage cannot be certified");
  assert.equal(await sourceDigest(), before, "tracked sources or package lock changed during coverage");
  const arguments_ = [`--root=${root}`, `--raw=${raw}`, `--reports=${reports}`];
  // Report-generation processes must not add documents while we enumerate raw.
  const reportEnvironment = { ...process.env };
  delete reportEnvironment.NODE_V8_COVERAGE;
  for (const script of ["report.mjs", "verify-report.mjs"]) {
    const result = run([path.join(root, "scripts", "coverage", script), ...arguments_], reportEnvironment);
    assert.equal(result.status, 0, `${script} failed`);
  }
  const integrity = JSON.parse(await readFile(path.join(reports, "integrity.json"), "utf8"));
  const summary = JSON.parse(await readFile(path.join(reports, "coverage-summary.json"), "utf8"));
  await writeFile(path.join(reports, "collection.json"), JSON.stringify({
    command: "npm run verify -- --concurrency=2 --reporter=spec",
    node: process.versions.node,
    c8: installed.version,
    sourceAndLockSha256: before,
    verificationPid: verification.pid,
    elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  }, null, 2) + "\n");
  const lines = [
    "## Whole-suite ReplayLock coverage", "",
    `Integrity verified for all ${integrity.trackedSources.length} tracked TypeScript sources.`,
    `${integrity.documentCount} V8 documents from ${integrity.processCount} processes; CLI, Vite transforms, and Vitest-worker recording were measured separately.`, "",
    "| Metric | Covered / total | Percent |", "|---|---:|---:|",
    ...["lines", "statements", "functions", "branches"].map((metric) => {
      const value = summary.total[metric];
      return `| ${metric} | ${value.covered} / ${value.total} | ${value.pct}% |`;
    }), "",
    "Informational coverage only: no percentage threshold. Download the HTML/LCOV/JSON artifact for source-level investigation.", "",
  ].join("\n");
  await writeFile(path.join(reports, "summary.md"), lines);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines);
  console.log(`Coverage reports: ${path.relative(root, reports)}`);
} finally {
  // Only the fresh directory allocated by this run is removed. Reports remain
  // in a distinct ignored run directory; no earlier report is overwritten.
  await rm(temporary, { recursive: true, force: true });
}

function run(arguments_, env) {
  const result = spawnSync(process.execPath, arguments_, { cwd: root, env, stdio: "inherit" });
  assert.ifError(result.error);
  return result;
}

async function sourceDigest() {
  const hash = createHash("sha256");
  for (const file of [...trackedSources(root), "package-lock.json"]) {
    hash.update(file).update("\0").update(await readFile(path.join(root, file))).update("\0");
  }
  return hash.digest("hex");
}
