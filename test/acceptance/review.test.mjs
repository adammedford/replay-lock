import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  artifactJson,
  createCandidate,
  parseCase,
  toCaseArtifact,
} from "../../dist/model.js";
import {
  compareReviewCandidates,
  describeReplacement,
  formatCandidateReview,
  retainAssumptionRefreshCandidates,
} from "../../dist/review.js";

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

test("candidate display shows exact canonical values and every provenance field deterministically", async () => {
  const candidate = assumedCandidate("zeta", ["exact input"], new TypeError("bad input"), "partial");
  const rendered = formatCandidateReview(candidate);
  assert.match(rendered, /Target: src\/example\.ts#zeta/);
  assert.match(rendered, /Canonical input: .*"kind":"string","value":"exact input"/);
  assert.match(rendered, /Canonical completion: .*"kind":"throw".*"name":"TypeError"/);
  assert.match(rendered, /Occurrences: 1/);
  assert.match(rendered, /Eligibility: likely-safe/);
  assert.match(rendered, /Automatic evidence: ASSUMED_UNKNOWN_EFFECT/);
  assert.match(rendered, /Source graph: sha256:a{64}/);
  assert.match(rendered, /Lockfile: sha256:b{64}/);
  assert.match(rendered, /Runtime: .*"node":"v22\.12\.0"/);
  assert.match(rendered, /Assumption reason: reviewed opaque dependency/);
  assert.match(rendered, /Assumption fingerprint: sha256:c{64}/);
  assert.match(rendered, /Assumption original evidence: .*UNKNOWN_PACKAGE_CALL/);
  assert.match(rendered, /Recording provenance: partial/);
  assert.equal(formatCandidateReview(candidate), rendered);
  assert.doesNotMatch(formatCandidateReview(makeCandidate("plain", [1], 2)), /Assumption reason:/,
    "positive control: assumption-only evidence is not invented for automatic analysis");

  const project = await makeProject();
  try {
    await writeFile(path.join(project, "package-lock.json"), "{}\n");
    const partial = await recordObservation(project, {
      token: "replaced-by-runtime-token",
      locator: candidate.locator,
      arguments: candidate.arguments,
      completion: candidate.completion,
      sourceGraphDigest: candidate.provenance.sourceGraphDigest,
      runtimeProfile: candidate.provenance.runtimeProfile,
      assumption: candidate.eligibility.assumption,
    }, true);
    assert.equal(partial.status, 2, output(partial));
    const reviewed = runReview(project, "skip\n");
    assert.equal(reviewed.status, 0, output(reviewed));
    assert.match(output(reviewed), /Recording provenance: partial/,
      "CLI must surface provenance from a partially recovered session");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
  console.log("candidate display verified");
});

test("accept reject and skip are independent one-candidate decisions with deterministic order", async () => {
  const project = await makeProject();
  try {
    const candidates = [
      makeCandidate("zeta", [1], 2),
      makeCandidate("alpha", [1], 3),
      makeCandidate("middle", [1], 4),
    ].sort(compareReviewCandidates);
    await writePending(project, [...candidates].reverse());
    const result = runReview(project, "reject\nskip\naccept\n");
    assert.equal(result.status, 0, output(result));
    const targets = [...output(result).matchAll(/Target: .*#(\w+)/g)].map((match) => match[1]);
    assert.deepEqual(targets, candidates.map((candidate) => candidate.locator.exportName));
    assert.match(output(result), /Rejected/);
    assert.match(output(result), /Skipped/);
    assert.match(output(result), /Accepted/);
    const pending = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    const cases = await jsonFiles(path.join(project, ".replaylock", "cases"));
    assert.deepEqual(pending, [`${candidates[1].caseId}.json`]);
    assert.deepEqual(cases, [`${candidates[2].caseId}.json`]);
    assert.equal(candidates[0].caseId === candidates[1].caseId, false,
      "positive control: independent decisions address distinct candidates");

    const undecidedProject = await makeProject();
    try {
      const undecided = makeCandidate("undecided", [8], 16);
      await writePending(undecidedProject, [undecided]);
      const noDecision = runReview(undecidedProject, "yes-to-all\n");
      assert.equal(noDecision.status, 2, output(noDecision));
      assert.match(output(noDecision), /No review decision recorded/);
      assert.equal((await jsonFiles(path.join(undecidedProject, ".replaylock", "observations", "pending"))).length, 1);
      assert.equal((await jsonFiles(path.join(undecidedProject, ".replaylock", "cases"))).length, 0);
    } finally {
      await rm(undecidedProject, { recursive: true, force: true });
    }
    console.log("review decisions verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("reject removes only its pending candidate while skip retains and later calls can recur", async () => {
  const project = await makeProject();
  try {
    const rejected = makeCandidate("rejected", [1], 2);
    const skipped = makeCandidate("skipped", [1], 3);
    const ordered = [rejected, skipped].sort(compareReviewCandidates);
    await writePending(project, ordered);
    const decisions = ordered.map((candidate) => candidate === rejected ? "reject" : "skip").join("\n") + "\n";
    assert.equal(runReview(project, decisions).status, 0);
    assert.deepEqual(await jsonFiles(path.join(project, ".replaylock", "observations", "pending")), [
      `${skipped.caseId}.json`,
    ]);
    await writePending(project, [makeCandidate("rejected", [1], 2)]);
    const recurring = runReview(project, "skip\nskip\n");
    assert.equal(recurring.status, 0, output(recurring));
    assert.match(output(recurring), /#rejected/);
    assert.equal((await jsonFiles(path.join(project, ".replaylock", "observations", "pending"))).length, 2);
    console.log("review pending behavior verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("acceptance writes deterministic versioned human-readable cases with complete provenance", async () => {
  const first = await makeProject();
  const second = await makeProject();
  try {
    const candidate = assumedCandidate("accepted", [7], 14, "partial");
    await Promise.all([writePending(first, [candidate]), writePending(second, [candidate])]);
    assert.equal(runReview(first, "accept\n").status, 0);
    assert.equal(runReview(second, "a\n").status, 0);
    const filename = `${candidate.caseId}.json`;
    const left = await readFile(path.join(first, ".replaylock", "cases", filename), "utf8");
    const right = await readFile(path.join(second, ".replaylock", "cases", filename), "utf8");
    assert.equal(left, right);
    assert.match(left, /^\{\n  "schemaVersion": 1,/);
    const artifact = parseCase(left);
    assert.deepEqual(artifact.arguments, candidate.arguments);
    assert.deepEqual(artifact.completion, candidate.completion);
    assert.deepEqual(artifact.eligibility, candidate.eligibility);
    assert.deepEqual(artifact.provenance, candidate.provenance);
    assert.equal(artifact.provenance.captureStatus, "partial");
    console.log("accepted artifact verified");
  } finally {
    await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]);
  }
});

test("accepted artifacts exclude nondurable local metadata and occurrence counts", async () => {
  const project = await makeProject();
  try {
    const candidate = makeCandidate("clean", [2], 4);
    const hostile = {
      ...candidate,
      occurrences: 27,
      timestamp: "2040-01-01T00:00:00Z",
      sessionId: "private-session",
      workerId: "private-worker",
      command: "node secret-command.js",
      environment: { SECRET: "must-not-commit" },
    };
    await writePending(project, [hostile]);
    assert.equal(runReview(project, "accept\n").status, 0);
    const text = await readFile(path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`), "utf8");
    for (const forbidden of ["occurrences", "timestamp", "sessionId", "workerId", "secret-command", "must-not-commit"]) {
      assert.equal(text.includes(forbidden), false, `${forbidden} must not become durable`);
    }
    assert.match(artifactJson(hostile), /must-not-commit/,
      "positive control: the fixture really contains forbidden local metadata");
    console.log("non durable provenance verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("replacement shows old versus new before explicit atomic acceptance", async () => {
  const project = await makeProject();
  try {
    const oldCandidate = assumedCandidate("replace", [3], 6, "complete");
    const oldCase = toCaseArtifact(oldCandidate);
    const refreshed = assumedCandidate("replace", [3], 6, "complete");
    refreshed.eligibility.assumption.reason = "refreshed opaque dependency";
    refreshed.eligibility.assumption.fingerprint = `sha256:${"d".repeat(64)}`;
    const repeatedRefresh = { ...refreshed, occurrences: 2 };
    const reconciled = retainAssumptionRefreshCandidates(
      [],
      [refreshed, repeatedRefresh],
      [oldCase],
    );
    assert.equal(reconciled[0]?.occurrences, 3,
      "refreshed assumption review retains its session-local occurrence count");
    const casePath = path.join(project, ".replaylock", "cases", `${oldCase.caseId}.json`);
    await mkdir(path.dirname(casePath), { recursive: true });
    await writeFile(casePath, artifactJson(oldCase));
    await writeFile(path.join(project, "package-lock.json"), "{}\n");
    const recorded = await recordObservation(project, {
      token: "replaced-by-runtime-token",
      locator: refreshed.locator,
      arguments: refreshed.arguments,
      completion: refreshed.completion,
      sourceGraphDigest: refreshed.provenance.sourceGraphDigest,
      runtimeProfile: refreshed.provenance.runtimeProfile,
      assumption: refreshed.eligibility.assumption,
    });
    assert.equal(recorded.status, 0, output(recorded));
    assert.match(output(recorded), /Recorded 1 candidate\(s\)/,
      "same completion with refreshed assumption must survive candidate formation");
    const [pendingName] = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    const pending = JSON.parse(await readFile(path.join(project, ".replaylock", "observations", "pending", pendingName), "utf8"));
    assert.equal(pending.replacesCaseId, oldCase.caseId);
    const before = await readFile(casePath, "utf8");
    const diff = describeReplacement(oldCase, refreshed);
    assert.ok(diff);
    assert.match(diff.diff, /reviewed opaque dependency/);
    assert.match(diff.diff, /refreshed opaque dependency/);

    const skipped = runReview(project, "skip\n");
    assert.equal(skipped.status, 0, output(skipped));
    assert.match(output(skipped), /Replacement diff/);
    assert.match(output(skipped), /reviewed opaque dependency/);
    assert.match(output(skipped), /refreshed opaque dependency/);
    assert.equal(await readFile(casePath, "utf8"), before, "skip must not overwrite the case");

    const accepted = runReview(project, "accept\n");
    assert.equal(accepted.status, 0, output(accepted));
    const after = parseCase(await readFile(casePath, "utf8"));
    assert.deepEqual(after.completion, oldCase.completion);
    assert.equal(after.eligibility.assumption.reason, "refreshed opaque dependency");
    assert.deepEqual((await readdir(path.dirname(casePath))).filter((name) => name.endsWith(".tmp")), [],
      "atomic replacement must not leave temporary artifacts");
    console.log("review replacement diff verified");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

function makeCandidate(exportName, arguments_, result, captureStatus = "complete") {
  return createCandidate({
    token: "token",
    locator: { module: "src/example.ts", exportName },
    arguments: arguments_,
    completion: result instanceof Error ? { kind: "throw", value: result } : { kind: "return", value: result },
    sourceGraphDigest: digestA,
    runtimeProfile,
  }, digestB, captureStatus);
}

function assumedCandidate(exportName, arguments_, result, captureStatus) {
  const candidate = makeCandidate(exportName, arguments_, result, captureStatus);
  candidate.eligibility = {
    basis: "assumption",
    verdict: "likely-safe",
    reasonCodes: ["ASSUMED_UNKNOWN_EFFECT"],
    assumption: {
      reason: "reviewed opaque dependency",
      fingerprint: `sha256:${"c".repeat(64)}`,
      analyzerVersion: "1",
      intrinsicCatalogVersion: "1",
      originalEvidence: [{
        code: "UNKNOWN_PACKAGE_CALL",
        source: "src/example.ts",
        line: 2,
        column: 3,
        message: "package behavior is unknown",
      }],
    },
  };
  return candidate;
}

async function makeProject() {
  return mkdtemp(path.join(os.tmpdir(), "replaylock-review-"));
}

async function writePending(project, candidates) {
  const directory = path.join(project, ".replaylock", "observations", "pending");
  await mkdir(directory, { recursive: true });
  for (const candidate of candidates) {
    await writeFile(path.join(directory, `${candidate.caseId}.json`), artifactJson(candidate));
  }
}

async function recordObservation(project, observation, leavePartialWriter = false) {
  const sourceDirectory = path.join(project, "src");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    path.join(sourceDirectory, "example.ts"),
    `/** @replaylock capture */\nexport function ${observation.locator.exportName}(value: number): number { return value; }\n`,
  );
  const child = path.join(project, "record-review-observation.mjs");
  const sessionUrl = pathToFileURL(path.join(root, "dist", "session.js")).href;
  await writeFile(child, `
import { mkdir, writeFile } from "node:fs/promises";
import { registerSessionWorker } from ${JSON.stringify(sessionUrl)};
const directory = process.env.REPLAYLOCK_SESSION_DIR;
const token = process.env.REPLAYLOCK_SESSION_TOKEN;
await mkdir(directory, { recursive: true });
await writeFile(directory + "/handshake.json", JSON.stringify({ token }) + "\\n");
const worker = registerSessionWorker(directory, token, "review-worker");
worker.writeCompleted({ ...${JSON.stringify(observation)}, token });
worker.close();
${leavePartialWriter ? 'registerSessionWorker(directory, token, "incomplete-review-worker");' : ""}
`);
  return spawnSync(process.execPath, [cli, "record", "--", process.execPath, child], {
    cwd: project,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function runReview(project, input) {
  return spawnSync(process.execPath, [cli, "review"], {
    cwd: project,
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}
