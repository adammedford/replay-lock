import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 29 acceptance suite verified");
} else if (scenario === "bun-lockfile") {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/package-catalog-bun-lockfile.test.mjs"]);
  console.log("bun.lock trusted-package version resolution verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("bun.lock trusted-package documentation verified");
} else {
  throw new Error(`unknown issue 29 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const doc = await readFile(path.join(root, "docs", "trusted-packages.md"), "utf8");
  assert.match(doc, /bun\.lock/, "doc must name bun.lock");
  assert.match(doc, /bun\.lockb/, "doc must still name bun.lockb as unparsed");
  assert.match(doc, /scoped name/, "doc must describe the scoped-name split rule");
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
