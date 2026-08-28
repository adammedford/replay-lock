import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("adapter branch composes purity separation with fail-closed trust boundaries", () => {
  const checks = [
    ["scripts/verify-issue-16.mjs", "purity", "adapter purity separation verified"],
    ["scripts/verify-issue-17.mjs", "registration", "adapter registration diagnostics verified"],
    ["scripts/verify-issue-18.mjs", "isolation", "isolated adapter validation verified"],
    ["scripts/verify-issue-18.mjs", "preflight", "adapter replay preflight verified"],
    ["scripts/verify-issue-19.mjs", "recording", "recording adapter failure isolation verified"],
    ["scripts/verify-issue-19.mjs", "completion", "completion adapter failure verified"],
    ["scripts/verify-issue-19.mjs", "refactors", "adapter refactor stability verified"],
  ];
  for (const [script, scenario, marker] of checks) {
    const result = spawnSync(process.execPath, [script, scenario], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(marker));
  }
  console.log("adapter branch integration verified");
});
