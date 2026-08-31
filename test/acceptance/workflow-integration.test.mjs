import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate, parseCase } from "../../dist/model.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
// Stored locators use POSIX separators even on a Windows filesystem.
const sourcePath = "src/calculation.ts";
const originalSource = `/** @replaylock capture */
export function double(value: number): number { return value * 2; }
`;
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

test("reviewed cases flow through whole-set preflight and fresh replay with stable exit classes", async () => {
  const project = await makeProject();
  try {
    const candidate = createCandidate({
      token: "t".repeat(64),
      locator: { module: sourcePath, exportName: "double" },
      arguments: [4],
      completion: { kind: "return", value: 8 },
      sourceGraphDigest: `sha256:${"a".repeat(64)}`,
      runtimeProfile,
    }, `sha256:${"b".repeat(64)}`);
    await writeFile(
      path.join(project, ".replaylock", "observations", "pending", `${candidate.caseId}.json`),
      artifactJson(candidate),
    );

    const review = runCli(project, "review", "a\n");
    assert.equal(review.status, 0, output(review));
    assert.match(output(review), new RegExp(`Accepted ${candidate.caseId}`));
    assert.deepEqual(await readdir(path.join(project, ".replaylock", "observations", "pending")), []);

    const casePath = path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`);
    const acceptedBytes = await readFile(casePath);
    const accepted = parseCase(acceptedBytes.toString("utf8"));
    assert.deepEqual(accepted.arguments, candidate.arguments);
    assert.deepEqual(accepted.completion, candidate.completion);

    const success = runCli(project, "verify");
    assert.equal(success.status, 0, output(success));
    assert.match(output(success), /Verified 1 case\(s\)/);
    await assertCaseUnchanged(casePath, acceptedBytes, "successful replay");

    await writeFile(
      path.join(project, sourcePath),
      originalSource.replace("value * 2", "value * 3"),
    );
    const behavioral = runCli(project, "verify");
    assert.equal(behavioral.status, 1, output(behavioral));
    assert.match(output(behavioral), /OUTPUT_MISMATCH src\/calculation\.ts#double/);
    assert.doesNotMatch(output(behavioral), /Verified 1 case/);
    await assertCaseUnchanged(casePath, acceptedBytes, "behavioral failure");

    await writeFile(
      path.join(project, sourcePath),
      originalSource
        .replace("@replaylock capture", "@replaylock exclude retired")
        .replace("value * 2", "value * 3"),
    );
    const preflight = runCli(project, "verify");
    assert.equal(preflight.status, 2, output(preflight));
    assert.match(output(preflight), /CAPTURE_POLICY_CHANGED src\/calculation\.ts#double/);
    assert.doesNotMatch(output(preflight), /OUTPUT_MISMATCH|COMPLETION_KIND_MISMATCH|Verified 1 case/);
    assert.deepEqual(await readdir(path.join(project, ".replaylock", "verify")), []);
    await assertCaseUnchanged(casePath, acceptedBytes, "preflight failure");

    // Keep the behavior mismatched as a positive control: reaching the target
    // would create OUTPUT_MISMATCH and exit 1 instead of infrastructure exit 2.
    await writeFile(path.join(project, sourcePath), originalSource.replace("value * 2", "value * 3"));
    await writeFile(path.join(project, "package.json"), "{ malformed project metadata\n");
    const infrastructure = runCli(project, "verify");
    assert.equal(infrastructure.status, 2, output(infrastructure));
    assert.doesNotMatch(output(infrastructure), /OUTPUT_MISMATCH|COMPLETION_KIND_MISMATCH|Verified 1 case/);
    assert.deepEqual(await readdir(path.join(project, ".replaylock", "verify")), []);
    await assertCaseUnchanged(casePath, acceptedBytes, "infrastructure failure");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
  console.log("workflow branch integration verified");
});

async function makeProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-workflow-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "observations", "pending"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "verify"), { recursive: true });
  await writeFile(path.join(project, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
  await writeFile(path.join(project, sourcePath), originalSource);
  return project;
}

function runCli(project, command, input) {
  return spawnSync(process.execPath, [cliPath, command], {
    cwd: project,
    encoding: "utf8",
    input,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

async function assertCaseUnchanged(casePath, expected, phase) {
  assert.deepEqual(await readFile(casePath), expected, `${phase} changed accepted case bytes`);
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
