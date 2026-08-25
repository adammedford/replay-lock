import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";
const scenarios = {
  policy: {
    pattern: "source policy captures supported direct exports",
    marker: "source policy selection verified",
  },
  invalid: {
    pattern: "invalid source policies",
    marker: "invalid policy handling verified",
  },
  unsupported: {
    pattern: "annotated unsupported callable shapes",
    marker: "unsupported callable handling verified",
  },
  locators: {
    pattern: "callable locators|case artifacts reject traversal",
    marker: "callable locator rules verified",
  },
  all: {
    pattern: undefined,
    marker: "issue 3 acceptance suite verified",
  },
};
assert.ok(scenario in scenarios, `unknown issue 3 verification scenario: ${scenario}`);

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
const selected = scenarios[scenario];
const testArguments = ["--test", "--test-concurrency=1"];
if (selected.pattern) testArguments.push(`--test-name-pattern=${selected.pattern}`);
testArguments.push("test/acceptance/source-policy.test.mjs");
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
