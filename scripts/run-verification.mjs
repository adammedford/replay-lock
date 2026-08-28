import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceFiles = [
  "test/acceptance/core.test.mjs",
  "test/acceptance/source-policy.test.mjs",
  "test/acceptance/effects.test.mjs",
  "test/acceptance/call-graph.test.mjs",
  "test/acceptance/assumptions.test.mjs",
  "test/acceptance/analysis-integration.test.mjs",
  "test/acceptance/recording-wrapper.test.mjs",
  "test/acceptance/canonical.test.mjs",
  "test/acceptance/canonical-safety.test.mjs",
  "test/acceptance/observation-safety.test.mjs",
  "test/acceptance/sessions.test.mjs",
  "test/acceptance/candidates.test.mjs",
  "test/acceptance/recording-integration.test.mjs",
  "test/acceptance/review.test.mjs",
  "test/acceptance/verification-preflight.test.mjs",
  "test/acceptance/verification-replay.test.mjs",
  "test/acceptance/workflow-integration.test.mjs",
  "test/acceptance/adapters-journey.test.mjs",
  "test/acceptance/adapter-registry.test.mjs",
  "test/acceptance/adapter-validation.test.mjs",
  "test/acceptance/adapter-evolution.test.mjs",
  "test/acceptance/adapter-integration.test.mjs",
  "test/acceptance/documentation.test.mjs",
  "test/acceptance/package-catalog-validation.test.mjs",
  "test/acceptance/package-catalog-integration.test.mjs",
  "test/acceptance/async-journey.test.mjs",
  "test/acceptance/async-effects.test.mjs",
  "test/acceptance/async-effects-integration.test.mjs",
  "test/acceptance/scan.test.mjs",
  "test/acceptance/package-catalog-bun-lockfile.test.mjs",
  "test/acceptance/package-catalog-pnpm-lockfile.test.mjs",
  "test/acceptance/package-catalog-yarn-lockfile.test.mjs",
  "test/acceptance/review-batch.test.mjs",
  "test/acceptance/ci-verify-example.test.mjs",
  "test/acceptance/tolerance-comparison.test.mjs",
];
run("verify-package-contract.mjs");
runAcceptanceSuite();
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

function runAcceptanceSuite() {
  const discovered = readdirSync(path.join(root, "test", "acceptance"))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `test/acceptance/${name}`)
    .sort();
  assert.deepEqual(
    [...acceptanceFiles].sort(),
    discovered,
    "locked V1 suite manifest must include every acceptance file exactly once",
  );
  const result = spawnSync(process.execPath, [
    "--test",
    "--test-reporter=dot",
    "--test-concurrency=1",
    ...acceptanceFiles,
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "locked V1 black-box acceptance suite failed");
}
