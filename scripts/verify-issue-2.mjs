import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";
const scenarios = {
  record: {
    pattern: "record observes one natural call without synthetic invocation",
    marker: "record observation verified",
  },
  review: {
    pattern: "one explicit acceptance creates one deterministic case and no generated test",
    marker: "review acceptance verified",
  },
  verify: {
    pattern: "verify uses fresh Vitest and reports behavior drift without changing the case",
    marker: "verify behavior verified",
  },
  all: {
    pattern: undefined,
    marker: "issue 2 acceptance suite verified",
  },
};
assert.ok(scenario in scenarios, `unknown issue 2 verification scenario: ${scenario}`);

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
const selected = scenarios[scenario];
const testArguments = ["--test", "--test-concurrency=1"];
if (selected.pattern) testArguments.push(`--test-name-pattern=${selected.pattern}`);
testArguments.push("test/acceptance/core.test.mjs");
run(process.execPath, testArguments);
console.log(selected.marker);

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
