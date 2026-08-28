import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";
const focused = {
  workflow: ["V1 workflow documentation", "V1 workflow documentation verified"],
  terminology: ["V1 terminology", "V1 terminology verified"],
  privacy: ["V1 privacy guidance", "V1 privacy guidance verified"],
  adapters: ["adapter trust documentation", "adapter trust documentation verified"],
  troubleshooting: ["V1 troubleshooting", "V1 troubleshooting verified"],
};

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 20 acceptance suite verified");
} else {
  assert.ok(Object.hasOwn(focused, scenario), `unknown issue 20 verification scenario: ${scenario}`);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  const [pattern, marker] = focused[scenario];
  run(process.execPath, ["--test", "--test-concurrency=1", `--test-name-pattern=${pattern}`, "test/acceptance/documentation.test.mjs"]);
  console.log(marker);
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
