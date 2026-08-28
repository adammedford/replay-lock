import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 28 acceptance suite verified");
} else if (scenario === "scan") {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/scan.test.mjs"]);
  console.log("scan command verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("scan command documentation verified");
} else {
  throw new Error(`unknown issue 28 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /## Scan/, "README must document the scan command");
  assert.match(readme, /replaylock scan/, "README must show the scan command invocation");
  for (const code of ["SCAN_ELIGIBLE", "SCAN_NEEDS_REVIEW", "SCAN_INELIGIBLE", "SCAN_UNSUPPORTED_SHAPE", "SCAN_EXCLUDED"]) {
    assert.match(readme, new RegExp(code), `README must document ${code}`);
  }
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
