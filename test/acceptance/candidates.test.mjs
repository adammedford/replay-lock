import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  candidateStates,
  formPendingCandidateStates,
  observationBlocksAreNonFatal,
  OBSERVED_NONDETERMINISM,
  validateCandidateSessionRecord,
} from "../../dist/candidates.js";
import { artifactJson, createCandidate, toCaseArtifact } from "../../dist/model.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeProfile = {
  node: "v22.0.0",
  vite: "8.0.0",
  vitest: "4.0.0",
  replaylock: "0.1.0",
  platform: process.platform,
  architecture: process.arch,
  timezone: "UTC",
  locale: "en-US",
};

test("pending states distinguish candidates, blocked records, and valueless incomplete records", () => {
  const candidate = makeCandidate("safe", [1], 2);
  const states = formPendingCandidateStates({
    observations: [candidate],
    blocked: [{ code: "SENSITIVE_VALUE", locator: locator("secret"), safePath: "$.[redacted]" }],
    incomplete: [{ code: "SESSION_PARTIAL", locator: locator("unfinished") }],
  });
  assert.deepEqual(states.map((state) => state.state), ["candidate", "blocked", "incomplete"]);
  for (const state of states.filter((value) => value.state !== "candidate")) {
    assert.equal(JSON.stringify(state).includes("arguments"), false);
    assert.equal(JSON.stringify(state).includes("completion"), false);
    assert.equal(JSON.stringify(state).includes("captured"), false);
  }
  const durableBlock = validateCandidateSessionRecord({
    state: "blocked",
    block: { code: "SENSITIVE_VALUE", locator: locator("secret"), safePath: "$.[redacted]" },
  });
  assert.equal(durableBlock.state, "blocked");
  assert.throws(() => validateCandidateSessionRecord({
    state: "blocked",
    block: {
      code: "SENSITIVE_VALUE",
      locator: locator("secret"),
      arguments: ["must-not-survive"],
    },
  }), /must not contain captured values/);
});

test("identical observations merge with a session-local occurrence count deterministically", () => {
  const first = makeCandidate("duplicate", [3], 9);
  const secondBase = makeCandidate("duplicate", [3], 9);
  const second = {
    ...secondBase,
    occurrences: 2,
    provenance: { ...secondBase.provenance, sourceGraphDigest: digestB },
  };
  const forward = formPendingCandidateStates({ observations: [first, second] });
  const reverse = formPendingCandidateStates({ observations: [second, first] });
  assert.equal(candidateStates(forward)[0]?.occurrences, 3);
  assert.deepEqual(forward, reverse);
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
});

test("within-session completion conflicts block every candidate as OBSERVED_NONDETERMINISM", () => {
  const two = makeCandidate("unstable", [1], 2);
  const three = makeCandidate("unstable", [1], 3);
  for (const observations of [[two, three], [three, two]]) {
    const states = formPendingCandidateStates({ observations });
    assert.equal(candidateStates(states).length, 0);
    assert.deepEqual(states, [{
      state: "blocked",
      block: { code: OBSERVED_NONDETERMINISM, locator: locator("unstable"), caseId: two.caseId },
    }]);
    assert.equal(JSON.stringify(states).includes('"value"'), false);
  }
  assert.equal(candidateStates(formPendingCandidateStates({ observations: [two] })).length, 1,
    "positive control: a single completion remains eligible");
});

test("later behavior changes become replacement candidates rather than session nondeterminism", () => {
  const accepted = toCaseArtifact(makeCandidate("changed", [4], 8));
  const changed = makeCandidate("changed", [4], 12);
  const replacement = formPendingCandidateStates({ observations: [changed], acceptedCases: [accepted] });
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0]?.state, "candidate");
  assert.equal(replacement[0]?.candidate.replacesCaseId, accepted.caseId);
  assert.equal(replacement[0]?.candidate.completion.value.value, 12);

  const unchanged = formPendingCandidateStates({
    observations: [makeCandidate("changed", [4], 8)],
    acceptedCases: [accepted],
  });
  assert.deepEqual(unchanged, [], "an observation identical to its accepted case is not re-proposed");
});

test("observation-scoped blocks retain unrelated safe candidates", () => {
  const safe = makeCandidate("safe", [2], 4);
  const cases = [
    "MUTATED_INPUT",
    "SENSITIVE_VALUE",
    "UNSUPPORTED_VALUE",
    "VALUE_ADAPTER_BLOCK",
    "OVERSIZED_OBSERVATION",
  ];
  for (const code of cases) {
    const states = formPendingCandidateStates({
      observations: [safe],
      blocked: [{ code, locator: locator(`blocked-${code}`) }],
    });
    assert.deepEqual(candidateStates(states).map((candidate) => candidate.locator.exportName), ["safe"]);
    assert.equal(states.some((state) => state.state === "blocked" && state.block.code === code), true);
  }
});

test("observation-scoped blocks are non-fatal to an otherwise clean session", async () => {
  const blocked = formPendingCandidateStates({
    observations: [makeCandidate("safe", [5], 10)],
    blocked: [{ code: "SENSITIVE_VALUE", locator: locator("private") }],
  });
  assert.equal(observationBlocksAreNonFatal(blocked), true);
  assert.equal(candidateStates(blocked).length, 1);

  const partial = formPendingCandidateStates({
    observations: [],
    incomplete: [{ code: "SESSION_PARTIAL" }],
  });
  assert.equal(observationBlocksAreNonFatal(partial), false,
    "positive control: incomplete session data retains Issue 11 partial semantics");

  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-candidate-block-"));
  try {
    await writeFile(path.join(project, "package-lock.json"), "{}\n");
    await writeCaptureTargets(project, ["private"]);
    const child = path.join(project, "record-block.mjs");
    const sessionUrl = pathToFileURL(path.join(root, "dist", "session.js")).href;
    await writeFile(child, `
import { mkdir, writeFile } from "node:fs/promises";
import { registerSessionWorker } from ${JSON.stringify(sessionUrl)};
const directory = process.env.REPLAYLOCK_SESSION_DIR;
const token = process.env.REPLAYLOCK_SESSION_TOKEN;
await mkdir(directory, { recursive: true });
await writeFile(directory + "/handshake.json", JSON.stringify({ token }) + "\\n");
const worker = registerSessionWorker(directory, token, "blocked-worker");
worker.writeCompleted({
  state: "blocked",
  block: { code: "SENSITIVE_VALUE", locator: { module: "src/example.ts", exportName: "private" }, safePath: "$.[redacted]" },
});
worker.close();
`);
    const result = spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), "record", "--", process.execPath, child], {
      cwd: project,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /Recorded 0 candidate\(s\)/);
    assert.match(output, /Blocked 1 observation\(s\)/);
    assert.doesNotMatch(output, /REPLAYLOCK_FAILURE/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("within-session completion conflicts remove stale pending CLI candidates and retain unrelated safe candidates", async () => {
  for (const completions of [[2, 3], [3, 2]]) {
    const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-nondeterminism-cli-"));
    try {
      await writeFile(path.join(project, "package-lock.json"), "{}\n");
      await writeCaptureTargets(project, ["unstable", "safe"]);
      const old = makeCandidate("unstable", [1], 99);
      const pendingDirectory = path.join(project, ".replaylock", "observations", "pending");
      await mkdir(pendingDirectory, { recursive: true });
      await writeFile(path.join(pendingDirectory, `${old.caseId}.json`), artifactJson(old));
      const child = path.join(project, "record-observations.mjs");
      const sessionUrl = pathToFileURL(path.join(root, "dist", "session.js")).href;
      const observations = [
        rawObservation("unstable", [1], completions[0]),
        rawObservation("safe", [2], 4),
        rawObservation("unstable", [1], completions[1]),
      ];
      await writeFile(child, `
import { mkdir, writeFile } from "node:fs/promises";
import { registerSessionWorker } from ${JSON.stringify(sessionUrl)};
const directory = process.env.REPLAYLOCK_SESSION_DIR;
const token = process.env.REPLAYLOCK_SESSION_TOKEN;
await mkdir(directory, { recursive: true });
await writeFile(directory + "/handshake.json", JSON.stringify({ token }) + "\\n");
const worker = registerSessionWorker(directory, token, "candidate-worker");
for (const observation of ${JSON.stringify(observations)}) worker.writeCompleted({ ...observation, token });
worker.close();
`);
      const result = spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), "record", "--", process.execPath, child], {
        cwd: project,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(result.status, 0, output);
      assert.match(output, /OBSERVED_NONDETERMINISM src\/example\.ts#unstable/);
      assert.match(output, /Recorded 1 candidate\(s\)/);
      const pending = (await readdir(pendingDirectory)).filter((name) => name.endsWith(".json"));
      assert.equal(pending.includes(`${old.caseId}.json`), false);
      assert.equal(pending.length, 1);
      const retained = JSON.parse(await readFile(path.join(pendingDirectory, pending[0]), "utf8"));
      assert.equal(retained.locator.exportName, "safe");
      const blockedPath = path.join(project, ".replaylock", "observations", "blocked", `${old.caseId}.json`);
      const durableBlock = JSON.parse(await readFile(blockedPath, "utf8"));
      assert.deepEqual(Object.keys(durableBlock.block).sort(), ["caseId", "code", "locator"]);
      assert.equal(JSON.stringify(durableBlock).includes("completion"), false);
      assert.equal(JSON.stringify(durableBlock).includes("arguments"), false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

function makeCandidate(exportName, arguments_, result) {
  return createCandidate({
    token: "t",
    locator: locator(exportName),
    arguments: arguments_,
    completion: { kind: "return", value: result },
    sourceGraphDigest: digestA,
    runtimeProfile,
  }, digestB);
}

function locator(exportName) {
  return { module: "src/example.ts", exportName };
}

function rawObservation(exportName, arguments_, result) {
  return {
    locator: locator(exportName),
    arguments: arguments_,
    completion: { kind: "return", value: result },
    sourceGraphDigest: digestA,
    runtimeProfile,
  };
}

async function writeCaptureTargets(project, exportNames) {
  const sourceDirectory = path.join(project, "src");
  await mkdir(sourceDirectory, { recursive: true });
  const source = exportNames.map((exportName) =>
    `/** @replaylock capture */\nexport function ${exportName}(value: number): number { return value; }`,
  ).join("\n\n");
  await writeFile(path.join(sourceDirectory, "example.ts"), `${source}\n`);
}
