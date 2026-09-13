import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const nvmrc = (await readFile(path.join(root, ".nvmrc"), "utf8")).trim();
const gitignore = (await readFile(path.join(root, ".gitignore"), "utf8")).split(/\r?\n/);

assert.equal(process.versions.node.split(".")[0], "22", "verification must use Node 22");
assert.equal(nvmrc, "22.19.0");
assert.equal(packageJson.engines.node, ">=22.12.0 <23");
assert.equal(packageJson.packageManager, "npm@11.5.2");
assert.equal(packageJson.private, true, "open-source hosting must not enable npm publication");
assert.deepEqual(packageJson.repository, {
  type: "git",
  url: "git+https://github.com/adammedford/replay-lock.git",
});
assert.equal(packageJson.homepage, "https://github.com/adammedford/replay-lock#readme");
assert.deepEqual(packageJson.bugs, { url: "https://github.com/adammedford/replay-lock/issues" });
assert.equal(packageJson.bin.replaylock, "./dist/cli.js");
assert.equal(packageJson.exports["./vite"].default, "./dist/vite-plugin.js");
assert.equal(packageJson.exports["./vite/runtime"].default, "./dist/runtime.js");
for (const documentation of [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/value-adapters.md",
  "docs/troubleshooting.md",
  "docs/pilot-checklist.md",
]) assert.ok(packageJson.files.includes(documentation), `${documentation} must ship with the package`);
const license = await readFile(path.join(root, "LICENSE"), "utf8");
assert.match(license, /^MIT License\r?\n/, "the package must include its MIT license");
assert.ok(license.includes("Copyright (c) 2026 Adam Medford"));
assert.equal(packageJson.license, "MIT");
assert.equal(lock.packages[""].license, "MIT");
assert.ok(gitignore.includes(".replaylock/observations/"));
assert.ok(gitignore.includes(".replaylock/verify/"));
assert.ok(gitignore.includes(".replaylock/validate/"));
assert.equal(gitignore.includes(".replaylock/"), false, "accepted cases must remain committable");

const expected = {
  "magic-string": "1.2.3",
  typescript: "6.0.3",
  vite: "8.2.2",
  vitest: "4.1.11",
  "@types/node": "22.20.1",
  "@jridgewell/sourcemap-codec": "1.5.5",
  c8: "12.0.0",
};
for (const [name, version] of Object.entries(expected)) {
  const declared = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
  assert.equal(declared, version, `${name} must be pinned exactly`);
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} lock entry must match`);
}

// Invoke the locked compiler with Node: direct Windows spawn cannot execute npm.cmd.
assert.equal(packageJson.scripts.build, "tsc -p tsconfig.json");
const build = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
  cwd: root,
  encoding: "utf8",
});
assert.ifError(build.error);
assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
const cli = await readFile(path.join(root, "dist", "cli.js"), "utf8");
assert.ok(cli.startsWith("#!/usr/bin/env node"), "compiled CLI must retain its executable shebang");
const plugin = await import(pathToFileURL(path.join(root, "dist", "vite-plugin.js")).href);
assert.equal(typeof plugin.replaylock, "function");
assert.equal(plugin.replaylock().name, "replaylock");
const publicApi = await import(pathToFileURL(path.join(root, "dist", "index.js")).href);
assert.equal(publicApi.REPLAYLOCK_VERSION, packageJson.version);
assert.equal(typeof publicApi.defineReplayLock, "function");
assert.equal(typeof publicApi.defineValueAdapter, "function");

console.log("package contract verified");
