import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
run("verify-package-contract.mjs");
run("verify-issue-2.mjs", "all");
run("verify-issue-3.mjs", "all");
console.log("verification suite passed");

function run(script, ...arguments_) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...arguments_], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${script} failed`);
}
