import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { candidateStates, formPendingCandidateStates, validateCandidateSessionRecord } from "../../dist/candidates.js";
import { createCandidate, parseCandidate, toCaseArtifact, validateObservation } from "../../dist/model.js";
import { observeCall } from "../../dist/runtime.js";
import { aggregateSession } from "../../dist/session.js";
import { snapshotEntryArguments } from "../../dist/observation-safety.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "test", "fixtures", "core");
const cliPath = path.join(root, "dist", "cli.js");
const vitestPath = path.join(root, "node_modules", "vitest", "vitest.mjs");
const token = "a".repeat(64);
const metadata = {
  locator: { module: "src/direct.ts", exportName: "target" },
  sourceGraphDigest: `sha256:${"b".repeat(64)}`,
};

test("runtime keeps original arguments and records safe values, returns, and throws exactly once", async () => {
  const session = await mkdtemp(path.join(os.tmpdir(), "replaylock-recording-runtime-"));
  const previousDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const previousToken = process.env.REPLAYLOCK_SESSION_TOKEN;
  process.env.REPLAYLOCK_SESSION_DIR = session;
  process.env.REPLAYLOCK_SESSION_TOKEN = token;
  try {
    const input = { array: [null, true, "plain", 42], record: { answer: 42 } };
    let calls = 0;
    const returned = observeCall(metadata, [input], () => {
      calls += 1;
      assert.equal(input.record.answer, 42);
      return { ok: true, values: [null, "done", 7] };
    });
    assert.equal(calls, 1);
    assert.deepEqual(returned, { ok: true, values: [null, "done", 7] });

    const thrownValue = "ordinary synchronous throw";
    let caught;
    try {
      observeCall({ ...metadata, locator: { ...metadata.locator, exportName: "throws" } }, [1], () => {
        throw thrownValue;
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, thrownValue);

    const thrownError = new RangeError("ordinary error");
    try {
      observeCall({ ...metadata, locator: { ...metadata.locator, exportName: "throwsError" } }, [], () => {
        throw thrownError;
      });
      assert.fail("the exact error must be rethrown");
    } catch (error) {
      assert.equal(error, thrownError);
    }

    const canonicalLookingArgument = { kind: "number", value: 3 };
    const canonicalLookingReturn = observeCall(
      { ...metadata, locator: { ...metadata.locator, exportName: "canonicalLooking" } },
      [canonicalLookingArgument],
      () => ({ kind: "number", value: 4 }),
    );
    assert.deepEqual(canonicalLookingReturn, { kind: "number", value: 4 });

    const aggregated = aggregateSession(session, token, validateCandidateSessionRecord);
    assert.deepEqual(aggregated.failures, []);
    const observations = aggregated.records
      .filter((record) => record.state === "observation")
      .map((record) => record.observation);
    assert.equal(observations.length, 4);
    assert.equal(observations.find((value) => value.locator.exportName === "target")?.completion.kind, "return");
    assert.equal(observations.find((value) => value.locator.exportName === "throws")?.completion.kind, "throw");
    assert.deepEqual(
      observations.find((value) => value.locator.exportName === "throwsError")?.completion,
      { kind: "throw", error: { kind: "standard-error", name: "RangeError", message: "ordinary error" } },
    );
    const canonicalLooking = observations.find((value) => value.locator.exportName === "canonicalLooking");
    assert.equal(canonicalLooking?.arguments.items[0]?.kind, "record");
    assert.equal(canonicalLooking?.completion.kind, "return");
    assert.equal(canonicalLooking?.completion.kind === "return" && canonicalLooking.completion.value.kind, "record");

    const digest = `sha256:${"c".repeat(64)}`;
    const forward = candidateStates(formPendingCandidateStates({
      observations: observations.map((observation) => createCandidate(observation, digest)),
    }));
    const reverse = candidateStates(formPendingCandidateStates({
      observations: [...observations].reverse().map((observation) => createCandidate(observation, digest)),
    }));
    assert.deepEqual(forward, reverse);
  } finally {
    restoreEnvironment("REPLAYLOCK_SESSION_DIR", previousDirectory);
    restoreEnvironment("REPLAYLOCK_SESSION_TOKEN", previousToken);
    await rm(session, { recursive: true, force: true });
  }
});

test("entry safety snapshots are canonical and expose no hashing or persistence seam", () => {
  const safe = snapshotEntryArguments(metadata.locator, [{ answer: 42 }]);
  assert.equal(safe.safe, true);
  assert.equal("fingerprint" in safe, false);
  assert.equal("caseId" in safe, false);
  const blocked = snapshotEntryArguments(metadata.locator, [{ clientSecret: "never-hashed" }]);
  assert.equal(blocked.safe, false);
  assert.equal(JSON.stringify(blocked).includes("never-hashed"), false);
  assert.equal("fingerprint" in blocked, false);
});

test("legacy raw records with canonical-looking kind fields remain ordinary values", () => {
  const observation = validateObservation({
    token,
    locator: metadata.locator,
    arguments: [{ kind: "number", value: 3 }],
    completion: { kind: "return", value: { kind: "number", value: 4 } },
    sourceGraphDigest: metadata.sourceGraphDigest,
    runtimeProfile: {
      node: "v22", vite: "8", vitest: "4", replaylock: "0.1.0",
      platform: process.platform, architecture: process.arch, timezone: "UTC", locale: "en",
    },
  });
  assert.equal(observation.arguments.items[0]?.kind, "record");
  assert.equal(observation.completion.kind, "return");
  assert.equal(observation.completion.kind === "return" && observation.completion.value.kind, "record");
});

test("unsafe invocations become valueless blocks without losing unrelated safe candidates", async () => {
  const session = await mkdtemp(path.join(os.tmpdir(), "replaylock-recording-unsafe-"));
  const previousDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const previousToken = process.env.REPLAYLOCK_SESSION_TOKEN;
  process.env.REPLAYLOCK_SESSION_DIR = session;
  process.env.REPLAYLOCK_SESSION_TOKEN = token;
  const secret = "never-durable-secret-value";
  let invocations = 0;
  try {
    const shared = { value: 1 };
    const cycle = { value: 1 };
    cycle.self = cycle;
    const accessor = {};
    let getterCalls = 0;
    Object.defineProperty(accessor, "value", { enumerable: true, get() { getterCalls += 1; return secret; } });
    const proxy = new Proxy({}, { get() { throw new Error("proxy trap invoked"); } });
    let deep = true;
    for (let index = 0; index < 21; index += 1) deep = { child: deep };
    const unsafeInputs = [
      [{ password: secret }],
      [{ "ghp_property_name_must_never_be_durable": "ordinary" }],
      [proxy],
      [accessor],
      [shared, shared],
      [cycle],
      [deep],
    ];
    for (const arguments_ of unsafeInputs) {
      assert.equal(observeCall(metadata, arguments_, () => { invocations += 1; return 1; }), 1);
    }
    assert.equal(getterCalls, 0);
    assert.equal(observeCall({ ...metadata, locator: { ...metadata.locator, exportName: "safe" } }, [{ answer: 42 }], () => 84), 84);
    assert.equal(invocations, unsafeInputs.length);

    const aggregated = aggregateSession(session, token, validateCandidateSessionRecord);
    assert.equal(aggregated.records.filter((record) => record.state === "observation").length, 1);
    const blocks = aggregated.records.filter((record) => record.state === "blocked");
    assert.equal(blocks.length, unsafeInputs.length);
    assert.ok(blocks.some((record) => record.block.code === "SENSITIVE_VALUE"));
    assert.ok(blocks.some((record) => record.block.code === "OVERSIZED_OBSERVATION"));
    for (const block of blocks) {
      const durable = JSON.stringify(block);
      assert.equal(durable.includes("arguments"), false);
      assert.equal(durable.includes("completion"), false);
      assert.equal(durable.includes(secret), false);
    }
    const durableContents = await Promise.all((await recursiveFiles(session)).map((file) => readFile(file, "utf8")));
    assert.equal(durableContents.some((contents) => contents.includes(secret)), false);
    assert.equal(durableContents.some((contents) => contents.includes("ghp_property_name")), false);
  } finally {
    restoreEnvironment("REPLAYLOCK_SESSION_DIR", previousDirectory);
    restoreEnvironment("REPLAYLOCK_SESSION_TOKEN", previousToken);
    await rm(session, { recursive: true, force: true });
  }
});

test("Vite recording is hashbang-safe, collision-free, analysis-gated, and behavior-transparent", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-recording-vite-"));
  await cp(fixtureRoot, project, { recursive: true });
  await writeFile(path.join(project, "src", "calculation.js"), `#!/usr/bin/env node
import { effectHelper, safeHelper } from "./helper.js";
const __replaylockObserve = "application binding";
/** @replaylock capture */
export function safe(value) { return { binding: __replaylockObserve, nested: [value, true, null, "ok"] }; }
/** @replaylock capture */
export function throws(value) { throw value; }
/** @replaylock capture */
export function effectful(value) { console.log(value); return value; }
/** @replaylock capture */
export function unknown(callback, value) { return callback(value); }
/** @replaylock capture */
export function safeImported(value) { return safeHelper(value); }
/** @replaylock capture */
export function effectImported(value) { return effectHelper(value); }
function addThree(value) { return value + 3; }
function addFour(value) { return value + 4; }
/**
 * @replaylock capture
 * @replaylock assume-pure reviewed local dispatch contract
 */
export function assumed(flag, value) { return (flag ? addThree : addFour)(value); }
export function unannotated(value) { return value + 1; }
`);
  await writeFile(path.join(project, "src", "helper.js"), `export function safeHelper(value) { return value + 10; }
export function effectHelper(value) { console.log("helper", value); return value; }
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `import { assumed, effectImported, effectful, safe, safeImported, throws, unannotated, unknown } from "../src/calculation.js";
test("natural behavior", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(safe(7)).toEqual({ binding: "application binding", nested: [7, true, null, "ok"] });
  let caught;
  try { throws("plain throw"); } catch (error) { caught = error; }
  expect(caught).toBe("plain throw");
  expect(effectful(3)).toBe(3);
  expect(log).toHaveBeenCalledWith(3);
  expect(unknown((value) => value * 2, 4)).toBe(8);
  expect(safeImported(5)).toBe(15);
  expect(effectImported(6)).toBe(6);
  expect(assumed(true, 4)).toBe(7);
  expect(unannotated(4)).toBe(5);
});
`);
  const nodeModules = path.join(project, "node_modules");
  await mkdir(nodeModules);
  await symlink(root, path.join(nodeModules, "replaylock"), process.platform === "win32" ? "junction" : "dir");
  try {
    const result = spawnSync(process.execPath, [cliPath, "record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"], {
      cwd: project,
      encoding: "utf8",
      env: scrubbedEnvironment(),
      timeout: 30_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(result.status, 2, output);
    assert.match(output, /KNOWN_EFFECT src\/calculation\.js#effectful|KNOWN_EFFECT src\/calculation\.js:\d+:/);
    assert.match(output, /UNKNOWN_EFFECT src\/calculation\.js:/);
    const pendingDirectory = path.join(project, ".replaylock", "observations", "pending");
    const pendingFiles = (await readdir(pendingDirectory)).filter((name) => name.endsWith(".json")).sort();
    assert.equal(pendingFiles.length, 4);
    const candidates = await Promise.all(pendingFiles.map(async (filename) => JSON.parse(await readFile(path.join(pendingDirectory, filename), "utf8"))));
    assert.deepEqual(candidates.map((candidate) => candidate.locator.exportName).sort(), ["assumed", "safe", "safeImported", "throws"]);
    assert.equal(candidates.find((candidate) => candidate.locator.exportName === "throws")?.completion.kind, "throw");
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "effectful"), false);
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "unknown"), false);
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "effectImported"), false);
    const assumedCandidate = candidates.find((candidate) => candidate.locator.exportName === "assumed");
    assert.equal(assumedCandidate?.eligibility.basis, "assumption");
    assert.equal(assumedCandidate?.eligibility.assumption?.reason, "reviewed local dispatch contract");
    assert.match(assumedCandidate?.eligibility.assumption?.fingerprint ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.ok((assumedCandidate?.eligibility.assumption?.originalEvidence.length ?? 0) > 0);
    const explicitlyReviewedShape = toCaseArtifact(parseCandidate(JSON.stringify(assumedCandidate)));
    assert.deepEqual(explicitlyReviewedShape.eligibility.assumption, assumedCandidate.eligibility.assumption);
    assert.equal(candidates.some((candidate) => candidate.locator.exportName === "unannotated"), false);
    assert.deepEqual(await entriesOrEmpty(path.join(project, ".replaylock", "cases")), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("recording branch integration marker", () => {
  console.log("recording branch integration verified");
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function scrubbedEnvironment() {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return environment;
}

async function recursiveFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await recursiveFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function entriesOrEmpty(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
