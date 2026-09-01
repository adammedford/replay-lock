import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("coverage reporting merges real descendant V8 data, remaps source maps, and includes unloaded sources", async () => {
  const project = await realpath(await mkdtemp(path.join(os.tmpdir(), "replaylock-coverage-remapping-")));
  try {
    for (const directory of ["src", "raw", "reports", "foreign/dist"]) await mkdir(path.join(project, directory), { recursive: true });
    await writeFile(path.join(project, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      module: "NodeNext", target: "ES2023", sourceMap: true, rootDir: "src", outDir: "dist", types: [],
    }, include: ["src"] }));
    await writeFile(path.join(project, "src", "observed.ts"), "export function observed(value: number): number {\n  return value + 1;\n}\nobserved(1);\n");
    await writeFile(path.join(project, "src", "unloaded.ts"), "export function unloaded(): number {\n  return 42;\n}\n");
    await writeFile(path.join(project, "foreign", "dist", "observed.js"), "export const foreignCopy = true;\n");
    command("git", ["init", "--quiet"], project);
    command("git", ["add", "src"], project);
    command(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], project);
    // A real child-of-a-child writes V8 coverage; no counters are synthesized.
    await writeFile(path.join(project, "entry.mjs"), `
import { spawnSync } from "node:child_process";
const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./dist/observed.js'); await import('./foreign/dist/observed.js');"], { stdio: "inherit" });
process.exitCode = child.status;
`);
    command(process.execPath, ["entry.mjs"], project, { ...process.env, NODE_V8_COVERAGE: path.join(project, "raw") });
    const result = command(process.execPath, [path.join(root, "scripts", "coverage", "report.mjs"),
      `--root=${project}`, `--raw=${path.join(project, "raw")}`, `--reports=${path.join(project, "reports")}`], project);
    assert.match(result.stdout, /source coverage reports generated/);
    const coverage = JSON.parse(await readFile(path.join(project, "reports", "coverage-final.json"), "utf8"));
    assert.deepEqual(Object.keys(coverage).sort(), [path.join(project, "src", "observed.ts"), path.join(project, "src", "unloaded.ts")]);
    assert.ok(Object.values(coverage[path.join(project, "src", "observed.ts")].s).some((count) => count > 0));
    assert.ok(Object.values(coverage[path.join(project, "src", "unloaded.ts")].s).every((count) => count === 0));
    assert.match(await readFile(path.join(project, "reports", "index.html"), "utf8"), /Code coverage report/);
    const lcov = await readFile(path.join(project, "reports", "lcov.info"), "utf8");
    assert.ok(lcov.includes(`SF:${path.join("src", "observed.ts")}`));
    assert.doesNotMatch(lcov, /SF:.*dist/);

    // Vitest explicitly terminates workers. Normal Node-exit collection alone
    // loses their counters; exercise both real process and thread shutdowns.
    await symlink(path.join(root, "node_modules"), path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(project, "vitest.config.mjs"), "export default { test: { globals: true, include: ['*.test.mjs'] } };\n");
    await writeFile(path.join(project, "observed.test.mjs"), "import { observed } from './dist/observed.js';\ntest('observed behavior', () => { expect(observed(3)).toBe(4); });\n");
    for (const pool of ["forks", "threads"]) {
      const raw = path.join(project, `raw-${pool}`);
      await mkdir(raw);
      const preload = pathToFileURL(path.join(root, "scripts", "coverage", "flush-workers.mjs")).href;
      command(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", `--pool=${pool}`, "--maxWorkers=1"], project, {
        ...process.env, NODE_V8_COVERAGE: raw, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
      });
      const documents = await Promise.all((await readdir(raw)).filter((file) => file.startsWith("coverage-")).map(async (file) => JSON.parse(await readFile(path.join(raw, file), "utf8"))));
      const worker = documents.find((document) => document.result.some((script) => script.url.endsWith(`/vitest/dist/workers/${pool}.js`)));
      assert.ok(worker, `${pool}: raw coverage must include the actual Vitest worker`);
      assert.ok(worker.result.some((script) => script.url === pathToFileURL(path.join(project, "dist", "observed.js")).href
        && script.functions.some((fn) => fn.functionName === "observed" && fn.ranges[0].count > 0)), `${pool}: the worker must have executed the application function`);
      for (const file of await readdir(raw)) await copyFile(path.join(raw, file), path.join(project, "raw", file));
    }
    await writeFile(path.join(project, "ssr.mjs"), `
import { createServer } from "vite";
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
try {
  const { observed } = await server.ssrLoadModule("./dist/observed.js");
  if (observed(5) !== 6) throw new Error("SSR behavior changed");
} finally { await server.close(); }
`);
    command(process.execPath, ["ssr.mjs"], project, {
      ...process.env, NODE_V8_COVERAGE: path.join(project, "raw"),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.join(root, "scripts", "coverage", "flush-workers.mjs")).href}`.trim(),
    });
    command(process.execPath, [path.join(root, "scripts", "coverage", "report.mjs"),
      `--root=${project}`, `--raw=${path.join(project, "raw")}`, `--reports=${path.join(project, "reports")}`], project);
    const merged = JSON.parse(await readFile(path.join(project, "reports", "coverage-final.json"), "utf8"));
    const observed = merged[path.join(project, "src", "observed.ts")];
    const functions = Object.entries(observed.fnMap).filter(([, fn]) => fn.name === "observed");
    assert.deepEqual(Object.values(observed.fnMap).map((fn) => fn.name), ["observed"], "generated module wrappers are not authored functions");
    assert.equal(functions.length, 1, "native and VM-wrapped copies must map to one authored function");
    assert.equal(observed.f[functions[0][0]], 7, "native(1), fork(2), thread(2), and ordinary Vite SSR(2) calls must merge exactly");
    const captures = (await readdir(path.join(project, "raw"))).filter((file) => file.startsWith("sources-"));
    for (const file of captures) {
      const location = path.join(project, "raw", file);
      const bytes = await readFile(location, "utf8");
      const source = JSON.parse(bytes);
      const wrapped = Object.values(source).find((script) => script.source.startsWith("'use strict';async"));
      if (!wrapped) continue;
      wrapped.source = `/* unrecognized new wrapper */${wrapped.source}`;
      await writeFile(location, JSON.stringify(source));
      const invalid = spawnSync(process.execPath, [path.join(root, "scripts", "coverage", "report.mjs"),
        `--root=${project}`, `--raw=${path.join(project, "raw")}`, `--reports=${path.join(project, "reports")}`], { cwd: project, encoding: "utf8" });
      assert.notEqual(invalid.status, 0, "unrecognized source wrappers must fail closed");
      assert.match(invalid.stderr, /unrecognized executed-source wrapper/);
      await writeFile(location, bytes);
      break;
    }
    const ordinaryEnvironment = { ...process.env };
    delete ordinaryEnvironment.NODE_V8_COVERAGE;
    ordinaryEnvironment.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.join(root, "scripts", "coverage", "flush-workers.mjs")).href}`.trim();
    command(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--pool=forks", "--maxWorkers=1"], project, ordinaryEnvironment);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

function command(executable, args, cwd, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result;
}
