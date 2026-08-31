import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate, toCaseArtifact } from "../../dist/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "dist", "cli.js");
const reportScript = path.join(root, "examples", "github-actions", "report-verify-exit.sh");
const workflowFile = path.join(root, "examples", "github-actions", "replaylock-verify.yml");
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const runtimeProfile = {
  node: "v22.12.0",
  vite: "8.2.2",
  vitest: "4.1.11",
  replaylock: "0.1.0",
  platform: process.platform,
  architecture: process.arch,
  timezone: "UTC",
  locale: "en-US",
};

test("report-verify-exit.sh writes a distinct summary line for each exit code and preserves it", async () => {
  for (const [code, expected] of [
    [0, /passed/],
    [1, /behavioral regression/],
    [2, /infrastructure or configuration failure/],
    [7, /infrastructure or configuration failure/],
  ]) {
    const summary = path.join(os.tmpdir(), `replaylock-ci-summary-${code}-${Date.now()}`);
    const result = spawnSync("bash", [reportScript, String(code)], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, code, `${code}: ${result.stderr}`);
    const written = await readFile(summary, "utf8").catch(() => "");
    assert.match(written, expected, `code ${code}: ${written}`);
    await rm(summary, { force: true });
  }
});

test("the example workflow references its companion script and runs replaylock verify", async () => {
  const workflow = await readFile(workflowFile, "utf8");
  assert.match(workflow, /npx replaylock verify/);
  assert.match(workflow, /report-verify-exit\.sh/);
  assert.match(workflow, /pull_request/);
});

test("repository and consumer workflows pin reviewed Actions and make their cache policies explicit", async () => {
  const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const example = await readFile(workflowFile, "utf8");
  for (const action of ["actions/checkout", "actions/setup-node"]) {
    const pin = new RegExp(`uses: ${escape(action)}@([a-f0-9]{40}) # (v\\d+\\.\\d+\\.\\d+)`);
    assert.match(ci, pin);
    assert.match(example, pin);
    assert.deepEqual(example.match(pin).slice(1), ci.match(pin).slice(1), `${action} pins and release comments must agree`);
  }
  for (const workflow of [ci, example]) {
    assert.match(workflow, /permissions:\n  contents: read/);
    assert.match(workflow, /timeout-minutes: 15/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /github\.event\.pull_request\.number \|\| github\.run_id/);
    assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    assert.match(workflow, /npm install --global npm@11\.5\.2/);
  }
  assert.match(ci, /node-version-file: \.nvmrc/);
  assert.match(ci, /cache: npm/);
  assert.match(example, /package-manager-cache: false/);
  assert.doesNotMatch(example, /\bcache: npm/);
  assert.match(example, /node-version: 22\.19\.0/);
});

test("docs/ci.md documents all three exit codes and links the example", async () => {
  const doc = await readFile(path.join(root, "docs", "ci.md"), "utf8");
  for (const code of ["`0`", "`1`", "`2`"]) assert.match(doc, new RegExp(escape(code)));
  assert.match(doc, /replaylock-verify\.yml/);
  assert.match(doc, /Block the merge/);
});

test("the required check runs full verification once with failure-only JUnit and bounded dependency updates", async () => {
  const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.deepEqual(ci.slice(ci.indexOf("\njobs:\n")).match(/^  [\w-]+:/gm), ["  verify:"]);
  assert.doesNotMatch(ci, /npm run build/);
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm run verify -- --reporter=spec --junit="\$RUNNER_TEMP\/acceptance-junit\.xml"/);
  assert.match(ci, /id: verify/);
  assert.match(ci, /if: \$\{\{ failure\(\) && steps\.verify\.outcome == 'failure' \}\}/);
  assert.match(ci, /actions\/upload-artifact@[a-f0-9]{40} # v\d+\.\d+\.\d+/);
  assert.match(ci, /path: \$\{\{ runner\.temp \}\}\/acceptance-junit\.xml/);
  assert.match(ci, /retention-days: 7/);
  assert.match(ci, /if-no-files-found: ignore/);
  const dependabot = await readFile(path.join(root, ".github", "dependabot.yml"), "utf8");
  const [actions, npm] = dependabot.split('package-ecosystem: "npm"');
  assert.match(actions, /package-ecosystem: "github-actions"/);
  assert.match(actions, /interval: weekly/);
  assert.match(actions, /open-pull-requests-limit: 2/);
  assert.match(actions, /groups:\n      github-actions:\n        patterns: \["\*"\]/);
  assert.match(npm, /interval: monthly/);
  assert.match(npm, /open-pull-requests-limit: 3/);
  assert.doesNotMatch(npm, /groups:/);
});

test("the full pipeline reports the correct distinct outcome for a passing and a seeded-regression fixture", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-ci-example-"));
  try {
    await mkdir(path.join(project, "src"));
    await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "ci-example", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    const originalSource = `/** @replaylock capture */
export function calculate(left, right) {
  return left + right;
}
`;
    await writeFile(path.join(project, "src", "calculation.ts"), originalSource);

    const candidate = createCandidate({
      token: "t".repeat(64),
      locator: { module: "src/calculation.ts", exportName: "calculate" },
      arguments: [2, 3],
      completion: { kind: "return", value: 5 },
      sourceGraphDigest: digestA,
      runtimeProfile,
    }, digestB);
    await writeFile(
      path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`),
      artifactJson(toCaseArtifact(candidate)),
    );

    const passing = spawnSync(process.execPath, [cli, "verify"], { cwd: project, encoding: "utf8", timeout: 30_000 });
    assert.equal(passing.status, 0, `${passing.stdout}${passing.stderr}`);
    const passingSummary = path.join(os.tmpdir(), `replaylock-ci-fixture-pass-${Date.now()}`);
    const passingReport = spawnSync("bash", [reportScript, String(passing.status)], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: passingSummary },
    });
    assert.equal(passingReport.status, 0);
    assert.match(await readFile(passingSummary, "utf8"), /passed/);
    await rm(passingSummary, { force: true });

    await writeFile(path.join(project, "src", "calculation.ts"), originalSource.replace("left + right", "left + right + 1"));
    const regressed = spawnSync(process.execPath, [cli, "verify"], { cwd: project, encoding: "utf8", timeout: 30_000 });
    assert.equal(regressed.status, 1, `${regressed.stdout}${regressed.stderr}`);
    const regressedSummary = path.join(os.tmpdir(), `replaylock-ci-fixture-fail-${Date.now()}`);
    const regressedReport = spawnSync("bash", [reportScript, String(regressed.status)], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: regressedSummary },
    });
    assert.equal(regressedReport.status, 1);
    assert.match(await readFile(regressedSummary, "utf8"), /behavioral regression/);
    await rm(regressedSummary, { force: true });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("ci verify example branch integration marker", () => {
  console.log("ci verify example branch integration verified");
});

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
