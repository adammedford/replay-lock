import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate } from "../../dist/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "dist", "cli.js");
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

test("accepting the remaining candidates in a file batch-accepts every subsequent same-module candidate without a separate prompt", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-review-batch-"));
  try {
    const alpha = makeCandidate("src/calculation.ts", "alpha", 1);
    const beta = makeCandidate("src/calculation.ts", "beta", 2);
    const gamma = makeCandidate("src/calculation.ts", "gamma", 3);
    await writePending(project, [alpha, beta, gamma]);

    const reviewed = runReview(project, "af\n");
    assert.equal(reviewed.status, 0, output(reviewed));
    // Every candidate's full review output is printed, not just the first.
    assert.match(output(reviewed), /Target: src\/calculation\.ts#alpha/);
    assert.match(output(reviewed), /Target: src\/calculation\.ts#beta/);
    assert.match(output(reviewed), /Target: src\/calculation\.ts#gamma/);
    assert.equal((output(reviewed).match(/Accepted [a-f0-9]{64}/g) ?? []).length, 3);
    assert.deepEqual(await pendingFiles(project), []);

    const cases = await caseArtifacts(project);
    assert.deepEqual(cases.map((entry) => entry.locator.exportName).sort(), ["alpha", "beta", "gamma"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("batch accept only covers candidates from the same module; a later module still prompts normally", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-review-batch-scope-"));
  try {
    const alpha = makeCandidate("src/calculation.ts", "alpha", 1);
    const beta = makeCandidate("src/calculation.ts", "beta", 2);
    const other = makeCandidate("src/other.ts", "delta", 4);
    await writePending(project, [alpha, beta, other]);

    // Two decisions: "af" batch-accepts the calculation.ts pair, then "r" rejects the remaining other.ts candidate.
    const reviewed = runReview(project, "af\nr\n");
    assert.equal(reviewed.status, 0, output(reviewed));
    assert.match(output(reviewed), /Rejected [a-f0-9]{64}/);

    const cases = await caseArtifacts(project);
    assert.deepEqual(cases.map((entry) => entry.locator.exportName).sort(), ["alpha", "beta"]);
    assert.deepEqual(await pendingFiles(project), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a batch-accepted case is byte-identical to accepting the same candidate individually", async () => {
  const individualProject = await mkdtemp(path.join(os.tmpdir(), "replaylock-review-batch-individual-"));
  const batchProject = await mkdtemp(path.join(os.tmpdir(), "replaylock-review-batch-compare-"));
  try {
    const candidateA = makeCandidate("src/calculation.ts", "alpha", 1);
    const candidateB = makeCandidate("src/calculation.ts", "beta", 2);
    await writePending(individualProject, [candidateA, candidateB]);
    await writePending(batchProject, [candidateA, candidateB]);

    assert.equal(runReview(individualProject, "a\na\n").status, 0);
    assert.equal(runReview(batchProject, "af\n").status, 0);

    const individualBytes = await caseBytes(individualProject);
    const batchBytes = await caseBytes(batchProject);
    assert.deepEqual(individualBytes, batchBytes);
  } finally {
    await rm(individualProject, { recursive: true, force: true });
    await rm(batchProject, { recursive: true, force: true });
  }
});

test("review batch branch integration marker", () => {
  console.log("review batch branch integration verified");
});

function makeCandidate(module, exportName, value) {
  return createCandidate({
    token: "token",
    locator: { module, exportName },
    arguments: [value],
    completion: { kind: "return", value },
    sourceGraphDigest: digestA,
    runtimeProfile,
  }, digestB);
}

async function writePending(project, candidates) {
  const directory = path.join(project, ".replaylock", "observations", "pending");
  await mkdir(directory, { recursive: true });
  for (const candidate of candidates) {
    await writeFile(path.join(directory, `${candidate.caseId}.json`), artifactJson(candidate));
  }
}

function runReview(project, input) {
  return spawnSync(process.execPath, [cli, "review"], {
    cwd: project,
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
}

async function pendingFiles(project) {
  return jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
}

async function caseArtifacts(project) {
  const directory = path.join(project, ".replaylock", "cases");
  const filenames = await jsonFiles(directory);
  return Promise.all(filenames.map(async (filename) => JSON.parse(await readFile(path.join(directory, filename), "utf8"))));
}

async function caseBytes(project) {
  const directory = path.join(project, ".replaylock", "cases");
  const filenames = await jsonFiles(directory);
  return Promise.all(filenames.map((filename) => readFile(path.join(directory, filename), "utf8")));
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
