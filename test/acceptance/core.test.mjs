import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

test("record observes one natural call without synthetic invocation", async () => {
  const project = await makeProject();
  try {
    const result = runRecord(project);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /Recorded 1 candidate\(s\)/);

    const durableObservations = await durableCompletedObservations(project);
    assert.throws(
      () => assertSingleNaturalObservation([...durableObservations, durableObservations[0]]),
      "the duplicate-observation positive control must prove the assertion can fail",
    );
    assertSingleNaturalObservation(durableObservations);
    assert.deepEqual(durableObservations[0].arguments, [2, 3]);
    assert.deepEqual(durableObservations[0].completion, { kind: "return", value: 5 });

    const [candidateName] = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    assert.ok(candidateName, "record should create exactly one candidate");
    const candidate = JSON.parse(
      await readFile(path.join(project, ".replaylock", "observations", "pending", candidateName), "utf8"),
    );
    assert.deepEqual(candidate.arguments, {
      kind: "array",
      items: [
        { kind: "number", value: 2 },
        { kind: "number", value: 3 },
      ],
    });
    assert.deepEqual(candidate.completion, {
      kind: "return",
      value: { kind: "number", value: 5 },
    });
    assert.equal(candidate.occurrences, 1, "the candidate records the one observed occurrence");
    console.log("record observation verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("one explicit acceptance creates one deterministic case and no generated test", async () => {
  const first = await makeProject();
  const second = await makeProject();
  const positiveControl = await mkdtemp(path.join(os.tmpdir(), "replaylock-positive-control-"));
  try {
    runRecordChecked(first);
    const skipped = runCli(first, ["review"], "s\n");
    assert.equal(skipped.status, 0, output(skipped));
    assert.match(output(skipped), /Eligibility: likely-safe/);
    assert.match(output(skipped), /Source graph: sha256:[a-f0-9]{64}/);
    assert.match(output(skipped), /Lockfile: sha256:[a-f0-9]{64}/);
    assert.match(output(skipped), /Runtime:/);
    assert.equal((await jsonFiles(path.join(first, ".replaylock", "cases"))).length, 0);
    assert.equal((await jsonFiles(path.join(first, ".replaylock", "observations", "pending"))).length, 1);

    const accepted = runCli(first, ["review"], "a\n");
    assert.equal(accepted.status, 0, output(accepted));
    const firstCases = await jsonFiles(path.join(first, ".replaylock", "cases"));
    assert.equal(firstCases.length, 1);
    assert.equal((await jsonFiles(path.join(first, ".replaylock", "observations", "pending"))).length, 0);

    runRecordChecked(second);
    const secondAccepted = runCli(second, ["review"], "accept\n");
    assert.equal(secondAccepted.status, 0, output(secondAccepted));
    const secondCases = await jsonFiles(path.join(second, ".replaylock", "cases"));
    assert.deepEqual(secondCases, firstCases);
    const firstBytes = await readFile(path.join(first, ".replaylock", "cases", firstCases[0]));
    const secondBytes = await readFile(path.join(second, ".replaylock", "cases", secondCases[0]));
    assert.deepEqual(secondBytes, firstBytes, "accepted artifacts must be byte-for-byte deterministic");

    const artifact = JSON.parse(firstBytes.toString("utf8"));
    assert.equal(artifact.schemaVersion, 1);
    assert.equal(artifact.comparison, "exact");
    assert.equal(artifact.caseId, expectedCaseId(artifact));
    assert.deepEqual(artifact.arguments, {
      kind: "array",
      items: [
        { kind: "number", value: 2 },
        { kind: "number", value: 3 },
      ],
    });
    assert.deepEqual(artifact.completion, {
      kind: "return",
      value: { kind: "number", value: 5 },
    });
    assert.deepEqual(artifact.eligibility, {
      basis: "automatic",
      verdict: "likely-safe",
      reasonCodes: ["ISSUE_2_DIRECT_EXPORTED_SYNC_NUMERIC_LEAF"],
    });
    assert.match(artifact.provenance.sourceGraphDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(artifact.provenance.lockfileDigest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(artifact.provenance.runtimeProfile, {
      node: process.version,
      vite: "8.2.2",
      vitest: "4.1.11",
      replaylock: "0.1.0",
      platform: process.platform,
      architecture: process.arch,
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown",
      locale: new Intl.DateTimeFormat().resolvedOptions().locale,
    });
    assert.equal("occurrences" in artifact, false, "session-only occurrence data must not be accepted");
    for (const localOnlyField of ["timestamp", "sessionId", "workerId", "command", "environment"]) {
      assert.equal(localOnlyField in artifact, false, `${localOnlyField} must remain local`);
    }

    await writeFile(path.join(positiveControl, "generated.case.test.ts"), "// positive control\n");
    assert.equal(await containsGeneratedCaseTest(positiveControl), true, "positive control must prove the detector can fail");
    assert.equal(
      await containsGeneratedCaseTest(path.join(first, ".replaylock", "cases")),
      false,
      "accepted cases must not contain generated source tests",
    );
    console.log("review acceptance verified");
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(positiveControl, { recursive: true, force: true }),
    ]);
  }
});

test("verify uses fresh Vitest and reports behavior drift without changing the case", async () => {
  const project = await makeProject();
  try {
    runRecordChecked(project);
    const accepted = runCli(project, ["review"], "a\n");
    assert.equal(accepted.status, 0, output(accepted));
    const [caseName] = await jsonFiles(path.join(project, ".replaylock", "cases"));
    assert.ok(caseName);
    const casePath = path.join(project, ".replaylock", "cases", caseName);
    const before = await readFile(casePath);

    const passing = runCli(project, ["verify"]);
    assert.equal(passing.status, 0, output(passing));
    assert.match(output(passing), /Verified 1 case\(s\)/);

    const sourcePath = path.join(project, "src", "calculation.ts");
    const source = await readFile(sourcePath, "utf8");
    assert.match(source, /return left \+ right;/);
    await writeFile(sourcePath, source.replace("return left + right;", "return left * right;"));

    const failing = runCli(project, ["verify"]);
    assert.equal(failing.status, 1, output(failing));
    assert.match(output(failing), /OUTPUT_MISMATCH/);
    assert.deepEqual(await readFile(casePath), before, "verification must not update the accepted artifact");
    assert.deepEqual(
      await entriesOrEmpty(path.join(project, ".replaylock", "verify")),
      [],
      "the disposable Vitest harness and config must be removed",
    );
    console.log("verify behavior verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the black-box fixture completes record review verify and regression detection", async () => {
  const project = await makeProject();
  try {
    runRecordChecked(project);
    assert.equal(runCli(project, ["review"], "a\n").status, 0);
    assert.equal(runCli(project, ["verify"]).status, 0);
    const sourcePath = path.join(project, "src", "calculation.ts");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, source.replace("return left + right;", "return left - right;"));
    const regression = runCli(project, ["verify"]);
    assert.equal(regression.status, 1, output(regression));
    assert.match(output(regression), /OUTPUT_MISMATCH/);
    console.log("black-box journey verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function makeProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-core-"));
  await cp(fixtureRoot, project, { recursive: true });
  const nodeModules = path.join(project, "node_modules");
  await mkdir(nodeModules);
  await symlink(repositoryRoot, path.join(nodeModules, "replaylock"), process.platform === "win32" ? "junction" : "dir");
  return project;
}

function runRecord(project) {
  return runCli(project, [
    "record",
    "--",
    process.execPath,
    vitestPath,
    "run",
    "--config",
    "vitest.config.ts",
  ]);
}

function runRecordChecked(project) {
  const result = runRecord(project);
  assert.equal(result.status, 0, output(result));
  return result;
}

function runCli(project, arguments_, input) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env },
    input,
    timeout: 30_000,
  });
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function durableCompletedObservations(project) {
  const sessionsRoot = path.join(project, ".replaylock", "observations", "sessions");
  const observations = [];
  for (const session of (await readdir(sessionsRoot)).sort()) {
    const workersDirectory = path.join(sessionsRoot, session, "workers");
    for (const worker of (await readdir(workersDirectory)).sort()) {
      const chunksDirectory = path.join(workersDirectory, worker, "chunks");
      const chunks = (await readdir(chunksDirectory))
        .filter((name) => name.endsWith(".complete.json"))
        .sort();
      for (const chunk of chunks) {
        const envelope = JSON.parse(await readFile(path.join(chunksDirectory, chunk), "utf8"));
        observations.push(envelope.record);
      }
    }
  }
  return observations;
}

function assertSingleNaturalObservation(observations) {
  assert.equal(
    observations.length,
    1,
    "recording must contain exactly one durable completed natural-call observation",
  );
}

function expectedCaseId(artifact) {
  const fields = [
    String(artifact.schemaVersion),
    artifact.locator.module,
    artifact.locator.exportName,
    JSON.stringify(artifact.arguments),
  ];
  const identityBytes = fields
    .map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`)
    .join("");
  return createHash("sha256").update(identityBytes, "utf8").digest("hex");
}

async function entriesOrEmpty(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function containsGeneratedCaseTest(directory) {
  return (await readdir(directory)).some((name) => /\.case\.test\.[cm]?[jt]sx?$/.test(name));
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
