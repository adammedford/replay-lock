import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 27 acceptance suite verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("async trust boundary documentation verified");
} else if (scenario === "journey") {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/async-journey.test.mjs"]);
  console.log("async record/review/verify journey verified");
} else {
  throw new Error(`unknown issue 27 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(
    readme,
    /synchronous or `async`, but never a generator or async generator/,
    "README must state the async capture boundary",
  );
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
