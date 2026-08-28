import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 30 acceptance suite verified");
} else if (scenario === "pnpm-lockfile") {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/package-catalog-pnpm-lockfile.test.mjs"]);
  console.log("pnpm-lock.yaml trusted-package version resolution verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("pnpm-lock.yaml trusted-package documentation verified");
} else {
  throw new Error(`unknown issue 30 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const doc = await readFile(path.join(root, "docs", "trusted-packages.md"), "utf8");
  assert.match(doc, /pnpm-lock\.yaml/, "doc must name pnpm-lock.yaml");
  assert.match(doc, /importers/, "doc must describe reading from importers, not the flat packages map");
  assert.match(doc, /peer-dependency-qualified version/, "doc must describe the peer-suffix truncation rule");
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
