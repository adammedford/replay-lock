import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerificationOptions } from "./verification-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseVerificationOptions(process.argv.slice(2));
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
assertAcceptanceManifest();
run("verify-package-contract.mjs");
run("verify-packed-consumer.mjs", "--skip-build");
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

function assertAcceptanceManifest() {
  const discovered = readdirSync(path.join(root, "test", "acceptance"))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `test/acceptance/${name}`)
    .sort();
  assert.deepEqual(
    [...acceptanceFiles].sort(),
    discovered,
    "locked V1 suite manifest must include every acceptance file exactly once",
  );
}

function runAcceptanceSuite() {
  const reporters = [`--test-reporter=${options.reporter}`];
  if (options.junit !== undefined) {
    mkdirSync(path.dirname(options.junit), { recursive: true });
    reporters.push("--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=${options.junit}`);
  }
  const result = spawnSync(process.execPath, [
    "--test",
    ...reporters,
    `--test-concurrency=${options.concurrency}`,
    ...acceptanceFiles,
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, REPLAYLOCK_VERIFICATION_BUILD_READY: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "locked V1 black-box acceptance suite failed");
}
