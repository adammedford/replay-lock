import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runIssueVerification({ issueNumber, scenario, scenarios, testFile }) {
  assert.ok(
    Object.hasOwn(scenarios, scenario),
    `unknown issue ${issueNumber} verification scenario: ${scenario}`,
  );

  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  const selected = scenarios[scenario];
  const testArguments = ["--test", "--test-concurrency=1"];
  if (selected.pattern) testArguments.push(`--test-name-pattern=${selected.pattern}`);
  testArguments.push(testFile);
  run(process.execPath, testArguments);
  console.log(selected.marker);
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
