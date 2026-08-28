import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/workflow-integration.test.mjs"]);
console.log("workflow branch integration verified");

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
