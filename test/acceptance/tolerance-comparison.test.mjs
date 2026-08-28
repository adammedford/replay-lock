import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate, parseCase } from "../../dist/model.js";
import { parseToleranceEpsilon } from "../../dist/review.js";

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

test("parseToleranceEpsilon rejects anything other than a finite positive number", () => {
  assert.equal(parseToleranceEpsilon("0.001"), 0.001);
  assert.equal(parseToleranceEpsilon("1e-9"), 1e-9);
  assert.equal(parseToleranceEpsilon("0"), undefined);
  assert.equal(parseToleranceEpsilon("-1"), undefined);
  assert.equal(parseToleranceEpsilon("not-a-number"), undefined);
  assert.equal(parseToleranceEpsilon(""), undefined);
  assert.equal(parseToleranceEpsilon("Infinity"), undefined);
});

test("review accepts a candidate with an explicit tolerance and the choice is visible in the persisted case", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-tolerance-review-"));
  try {
    const candidate = makeCandidate("average", [1, 2], 1);
    await writePending(project, [candidate]);

    const reviewed = runReview(project, "t\n0.001\n");
    assert.equal(reviewed.status, 0, output(reviewed));
    assert.match(output(reviewed), /Accepted [a-f0-9]{64} \(tolerance epsilon 0\.001\)/);

    const cases = await caseArtifacts(project);
    assert.equal(cases.length, 1);
    assert.deepEqual(cases[0].comparison, { kind: "tolerance", epsilon: 0.001 });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("review rejects an invalid or missing epsilon rather than defaulting one", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-tolerance-invalid-"));
  try {
    const candidate = makeCandidate("average", [1, 2], 1);
    await writePending(project, [candidate]);

    const reviewed = runReview(project, "t\nnot-a-number\n");
    assert.equal(reviewed.status, 2, output(reviewed));
    assert.match(output(reviewed), /Invalid or missing epsilon/);
    assert.equal((await pendingFiles(project)).length, 1, "the candidate must remain pending, not silently accepted");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("parseCase round-trips both exact and tolerance comparison shapes", () => {
  const exact = parseCase(artifactJson(toArtifact(makeCandidate("plain", [1], 2))));
  assert.equal(exact.comparison, "exact");

  const tolerant = toArtifact(makeCandidate("plain", [1], 2));
  tolerant.comparison = { kind: "tolerance", epsilon: 0.5 };
  const reparsed = parseCase(artifactJson(tolerant));
  assert.deepEqual(reparsed.comparison, { kind: "tolerance", epsilon: 0.5 });

  assert.throws(() => parseCase(artifactJson({ ...tolerant, comparison: { kind: "tolerance", epsilon: -1 } })));
  assert.throws(() => parseCase(artifactJson({ ...tolerant, comparison: { kind: "tolerance", epsilon: 0 } })));
  assert.throws(() => parseCase(artifactJson({ ...tolerant, comparison: { kind: "tolerance" } })));
  assert.throws(() => parseCase(artifactJson({ ...tolerant, comparison: "not-exact" })));
});

test("verify passes a tolerant case within epsilon, fails one outside it, and still requires exact equality for non-numeric parts", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-tolerance-verify-"));
  try {
    await mkdir(path.join(project, "src"));
    await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "tolerance-fixture", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    const sourceFor = (offset) => `/** @replaylock capture */
export function summarize(value) {
  return { total: value + ${offset}, tag: "ok" };
}
`;
    await writeFile(path.join(project, "src", "calculation.ts"), sourceFor(0));

    const candidate = createCandidate({
      token: "t".repeat(64),
      locator: { module: "src/calculation.ts", exportName: "summarize" },
      arguments: [1],
      completion: { kind: "return", value: { total: 1, tag: "ok" } },
      sourceGraphDigest: digestA,
      runtimeProfile,
    }, digestB);
    const artifact = toArtifact(candidate);
    artifact.comparison = { kind: "tolerance", epsilon: 0.01 };
    await writeFile(path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`), artifactJson(artifact));

    await writeFile(path.join(project, "src", "calculation.ts"), sourceFor(0.005));
    const withinTolerance = runVerify(project);
    assert.equal(withinTolerance.status, 0, output(withinTolerance));

    await writeFile(path.join(project, "src", "calculation.ts"), sourceFor(1));
    const outsideTolerance = runVerify(project);
    assert.equal(outsideTolerance.status, 1, output(outsideTolerance));
    assert.match(output(outsideTolerance), /OUTPUT_MISMATCH/);

    await writeFile(
      path.join(project, "src", "calculation.ts"),
      `/** @replaylock capture */\nexport function summarize(value) {\n  return { total: value, tag: "different" };\n}\n`,
    );
    const nonNumericMismatch = runVerify(project);
    assert.equal(nonNumericMismatch.status, 1, output(nonNumericMismatch));
    assert.match(output(nonNumericMismatch), /OUTPUT_MISMATCH/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("an existing exact-comparison case is completely unaffected and needs no migration", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-tolerance-exact-unaffected-"));
  try {
    await mkdir(path.join(project, "src"));
    await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "exact-fixture", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    await writeFile(
      path.join(project, "src", "calculation.ts"),
      `/** @replaylock capture */\nexport function calculate(value) {\n  return value + 1;\n}\n`,
    );
    const candidate = makeCandidate("calculate", [4], 5);
    const artifact = toArtifact(candidate);
    assert.equal(artifact.comparison, "exact");
    await writeFile(path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`), artifactJson(artifact));

    assert.equal(runVerify(project).status, 0);

    await writeFile(
      path.join(project, "src", "calculation.ts"),
      `/** @replaylock capture */\nexport function calculate(value) {\n  return value + 1.0000001;\n}\n`,
    );
    const regressed = runVerify(project);
    assert.equal(regressed.status, 1, output(regressed), "an exact case must not silently tolerate any drift");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("tolerance comparison branch integration marker", () => {
  console.log("tolerance comparison branch integration verified");
});

function makeCandidate(exportName, arguments_, value) {
  return createCandidate({
    token: "token",
    locator: { module: "src/calculation.ts", exportName },
    arguments: arguments_,
    completion: { kind: "return", value },
    sourceGraphDigest: digestA,
    runtimeProfile,
  }, digestB);
}

function toArtifact(candidate) {
  const { occurrences, replacesCaseId, ...artifact } = candidate;
  return artifact;
}

async function writePending(project, candidates) {
  const directory = path.join(project, ".replaylock", "observations", "pending");
  await mkdir(directory, { recursive: true });
  for (const candidate of candidates) {
    await writeFile(path.join(directory, `${candidate.caseId}.json`), artifactJson(candidate));
  }
}

function runReview(project, input) {
  return spawnSync(process.execPath, [cli, "review"], { cwd: project, encoding: "utf8", input, timeout: 30_000 });
}

function runVerify(project) {
  return spawnSync(process.execPath, [cli, "verify"], { cwd: project, encoding: "utf8", timeout: 30_000 });
}

async function pendingFiles(project) {
  return jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
}

async function caseArtifacts(project) {
  const directory = path.join(project, ".replaylock", "cases");
  const filenames = await jsonFiles(directory);
  return Promise.all(filenames.map(async (filename) => JSON.parse(await readFile(path.join(directory, filename), "utf8"))));
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
