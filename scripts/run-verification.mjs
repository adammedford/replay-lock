import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerificationOptions } from "./verification-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseVerificationOptions(process.argv.slice(2));
const acceptanceFiles = [
  "test/acceptance/dev-analysis-cache.test.mjs",
  "test/acceptance/dev-conformance.test.mjs",
  "test/acceptance/dev-diagnostics.test.mjs",
  "test/acceptance/dev-pilots.test.mjs",
  "test/acceptance/dev-reporting.test.mjs",
  "test/acceptance/dev-retention.test.mjs",
  "test/acceptance/dev-artifacts.test.mjs",
  "test/acceptance/dev-integration.test.mjs",
  "test/acceptance/dev-trace.test.mjs",
  "test/acceptance/dev-transform.test.mjs",
  "test/acceptance/dev-yield.test.mjs",
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
  "test/acceptance/sensitive-parity.test.mjs",
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
// Files that drive a real headless browser. Two browsers plus two Vite dev
// servers sharing a CI runner starve each other and flake the browser-backed
// development tests, so these run one at a time in a second pass while every
// other file keeps the requested concurrency. The suite still runs every file
// exactly once, fails if any file fails, and produces one complete JUnit report.
const browserFiles = new Set([
  "test/acceptance/dev-artifacts.test.mjs",
  "test/acceptance/dev-conformance.test.mjs",
  "test/acceptance/dev-integration.test.mjs",
  "test/acceptance/dev-reporting.test.mjs",
]);
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
  const parallel = acceptanceFiles.filter((file) => !browserFiles.has(file));
  const serial = acceptanceFiles.filter((file) => browserFiles.has(file));
  if (options.junit !== undefined) mkdirSync(path.dirname(options.junit), { recursive: true });

  runAcceptancePass(parallel, options.concurrency, options.junit);
  if (serial.length === 0) return;

  // The browser pass writes to a sibling file that is merged into the primary
  // report before its status is asserted, so the JUnit stays complete even when
  // a browser file is the one that fails.
  const serialJunit = options.junit === undefined ? undefined : `${options.junit}.serial`;
  const serialResult = runAcceptancePass(serial, "1", serialJunit, false);
  if (options.junit !== undefined && serialJunit !== undefined) {
    mergeJunit(options.junit, serialJunit);
    rmSync(serialJunit, { force: true });
  }
  assert.equal(serialResult.status, 0, "locked V1 black-box acceptance suite failed");
}

function runAcceptancePass(files, concurrency, junit, assertPass = true) {
  const reporters = [`--test-reporter=${options.reporter}`];
  if (junit !== undefined) {
    reporters.push("--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=${junit}`);
  }
  const result = spawnSync(process.execPath, [
    "--test",
    ...reporters,
    `--test-concurrency=${concurrency}`,
    ...files,
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, REPLAYLOCK_VERIFICATION_BUILD_READY: "1" },
  });
  if (result.error) throw result.error;
  if (assertPass) assert.equal(result.status, 0, "locked V1 black-box acceptance suite failed");
  return result;
}

/** Fold one JUnit report's cases into another's single <testsuites> root. */
function mergeJunit(primaryPath, extraPath) {
  const extra = readFileSync(extraPath, "utf8");
  const open = extra.indexOf("<testsuites>");
  const close = extra.lastIndexOf("</testsuites>");
  if (open === -1 || close === -1) return;
  const cases = extra.slice(open + "<testsuites>".length, close);
  const primary = readFileSync(primaryPath, "utf8");
  const anchor = primary.lastIndexOf("</testsuites>");
  if (anchor === -1) return;
  writeFileSync(primaryPath, `${primary.slice(0, anchor)}${cases}${primary.slice(anchor)}`);
}
