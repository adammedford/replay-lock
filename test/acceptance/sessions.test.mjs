import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

import {
  aggregateSession,
  registerSessionWorker,
  replaceArtifactAtomic,
} from "../../dist/session.js";
import { observeCall } from "../../dist/runtime.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(root, "dist", "cli.js");
const sessionModuleUrl = pathToFileURL(path.join(root, "dist", "session.js")).href;
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);

test("observation storage is ignored and private while accepted cases remain source artifacts", async () => {
  const ignored = await readFile(path.join(root, ".gitignore"), "utf8");
  assert.match(ignored, /^\.replaylock\/observations\/$/m);
  assert.doesNotMatch(ignored, /^\.replaylock\/cases\/?$/m);

  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-permissions-"));
  try {
    const worker = registerSessionWorker(directory, tokenA, "worker-one");
    worker.writeCompleted({ answer: 42 });
    worker.close();
    if (process.platform !== "win32") {
      assert.equal((await stat(path.join(directory, "workers", "worker-one"))).mode & 0o777, 0o700);
      assert.equal(
        (await stat(path.join(directory, "workers", "worker-one", "registered.json"))).mode & 0o777,
        0o600,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workers register, write isolated completed chunks, and close cleanly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-workers-"));
  try {
    const first = registerSessionWorker(directory, tokenA, "first");
    const second = registerSessionWorker(directory, tokenA, "second");
    first.writeCompleted({ worker: 1, call: 1 });
    second.writeCompleted({ worker: 2, call: 1 });
    first.writeCompleted({ worker: 1, call: 2 });
    first.close();
    second.close();
    const aggregate = aggregateSession(directory, tokenA, (value) => value);
    assert.equal(aggregate.partial, false);
    assert.deepEqual(aggregate.records, [
      { worker: 1, call: 1 },
      { worker: 1, call: 2 },
      { worker: 2, call: 1 },
    ]);
    assert.deepEqual((await readdir(path.join(directory, "workers"))).sort(), ["first", "second"]);
    for (const unsafe of ["../escape", "nested/worker", "nested\\worker", ".", "..", ""])
      assert.throws(() => registerSessionWorker(directory, tokenA, unsafe), /safe filename segment/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent sessions stay isolated and pending plus accepted replacements are atomic", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-concurrency-"));
  const firstDirectory = path.join(project, "observations", "sessions", "first");
  const secondDirectory = path.join(project, "observations", "sessions", "second");
  try {
    const first = registerSessionWorker(firstDirectory, tokenA, "worker");
    const second = registerSessionWorker(secondDirectory, tokenB, "worker");
    first.writeCompleted({ session: "first" });
    second.writeCompleted({ session: "second" });
    first.close();
    second.close();
    assert.deepEqual(aggregateSession(firstDirectory, tokenA, (value) => value).records, [
      { session: "first" },
    ]);
    assert.deepEqual(aggregateSession(secondDirectory, tokenB, (value) => value).records, [
      { session: "second" },
    ]);

    const pending = path.join(project, "observations", "pending", "case.json");
    const accepted = path.join(project, "cases", "case.json");
    replaceArtifactAtomic(pending, '{"generation":1}\n');
    replaceArtifactAtomic(pending, '{"generation":2}\n');
    replaceArtifactAtomic(accepted, '{"reviewed":true}\n');
    assert.deepEqual(JSON.parse(await readFile(pending, "utf8")), { generation: 2 });
    assert.deepEqual(JSON.parse(await readFile(accepted, "utf8")), { reviewed: true });
    assert.equal((await readdir(path.dirname(pending))).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("non-closing writers, storage errors, malformed aggregation, and transforms are partial", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-partial-"));
  const storageFailure = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-storage-"));
  try {
    const writer = registerSessionWorker(directory, tokenA, "open-writer");
    writer.writeCompleted({ safe: true });
    const open = aggregateSession(directory, tokenA, (value) => value);
    assert.equal(open.partial, true);
    assert.equal(open.failures[0].reason, "NON_CLOSING_WRITER");
    assert.deepEqual(open.records, [{ safe: true }]);

    writer.close();
    const [chunk] = await readdir(path.join(directory, "workers", "open-writer", "chunks"));
    await writeFile(path.join(directory, "workers", "open-writer", "chunks", chunk), "not json\n");
    const malformed = aggregateSession(directory, tokenA, (value) => value);
    assert.equal(malformed.partial, true);
    assert.equal(malformed.failures[0].reason, "MALFORMED_CHUNK");

    await writeFile(path.join(storageFailure, "workers"), "not a directory");
    const unavailable = aggregateSession(storageFailure, tokenA, (value) => value);
    assert.equal(unavailable.partial, true);
    assert.equal(unavailable.failures[0].reason, "STORAGE_FAILURE");

    const project = await makeCliProject();
    try {
      const result = runSyntheticRecord(project, 0, { diagnostic: true, partialWriter: false });
      assert.equal(result.status, 2, output(result));
      assert.match(output(result), /SESSION_PARTIAL: one or more annotated callables were blocked/);
      assert.equal((await candidateFiles(project)).length, 1);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(storageFailure, { recursive: true, force: true }),
    ]);
  }
});

test("complete safe records survive partial sessions while incomplete records contain no values", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-survival-"));
  try {
    const argumentSentinel = "CAPTURED_ARGUMENT_SENTINEL";
    const completionSentinel = "CAPTURED_COMPLETION_SENTINEL";
    const complete = registerSessionWorker(directory, tokenA, "complete");
    complete.writeCompleted({
      arguments: [argumentSentinel],
      completion: { kind: "return", value: completionSentinel },
    });
    complete.writeCompleted({ rejectedByAggregator: true });
    complete.close();
    registerSessionWorker(directory, tokenA, "incomplete");
    const registration = await readFile(
      path.join(directory, "workers", "incomplete", "registered.json"),
      "utf8",
    );
    assert.equal(registration.includes("arguments"), false);
    assert.equal(registration.includes("completion"), false);
    assert.equal(registration.includes(argumentSentinel), false);
    assert.equal(registration.includes(completionSentinel), false);

    const sessionFiles = await recursiveFiles(directory);
    assert.equal(
      sessionFiles.some((filename) => /worker-.*\.jsonl$/.test(filename)),
      false,
      "legacy non-atomic observation artifacts must not exist",
    );
    for (const filename of sessionFiles.filter((name) => !name.endsWith(".complete.json"))) {
      const contents = await readFile(filename, "utf8");
      assert.equal(contents.includes(argumentSentinel), false, filename);
      assert.equal(contents.includes(completionSentinel), false, filename);
    }

    const aggregate = aggregateSession(directory, tokenA, (value) => {
      if (value?.rejectedByAggregator) throw new Error("invalid complete chunk");
      return value;
    });
    assert.equal(aggregate.partial, true);
    assert.equal(aggregate.records.length, 1);
    assert.deepEqual(aggregate.records[0], {
      arguments: [argumentSentinel],
      completion: { kind: "return", value: completionSentinel },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial success exits two and wrapped failure status remains primary with safe candidates", async () => {
  const successfulProject = await makeCliProject();
  const failingProject = await makeCliProject();
  try {
    const partial = runSyntheticRecord(successfulProject, 0, { partialWriter: true });
    assert.equal(partial.status, 2, output(partial));
    assert.match(output(partial), /^SESSION_PARTIAL:/m);
    assert.equal((await candidateFiles(successfulProject)).length, 1);

    const failed = runSyntheticRecord(failingProject, 7, { partialWriter: true });
    assert.equal(failed.status, 7, output(failed));
    assert.match(output(failed), /^SESSION_PARTIAL:/m);
    assert.match(output(failed), /Wrapped command exited with status 7/);
    assert.equal((await candidateFiles(failingProject)).length, 1);
  } finally {
    await Promise.all([
      rm(successfulProject, { recursive: true, force: true }),
      rm(failingProject, { recursive: true, force: true }),
    ]);
  }
});

test("runtime storage failure preserves behavior, writes a value-free marker, and cannot yield a trusted record", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-runtime-storage-failure-"));
  const token = "a".repeat(64);
  const secretArgument = "STORAGE_FAILURE_ARGUMENT_SECRET";
  const secretCompletion = "STORAGE_FAILURE_COMPLETION_SECRET";
  const previousDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const previousToken = process.env.REPLAYLOCK_SESSION_TOKEN;
  try {
    // The marker directory remains writable, while worker registration cannot
    // create its storage tree. This forces the runtime's public catch path.
    await writeFile(path.join(directory, "workers"), "blocked\n");
    process.env.REPLAYLOCK_SESSION_DIR = directory;
    process.env.REPLAYLOCK_SESSION_TOKEN = token;
    const metadata = {
      locator: { module: "src/direct.ts", exportName: "calculate" },
      sourceGraphDigest: `sha256:${"d".repeat(64)}`,
    };
    assert.equal(
      observeCall(metadata, [secretArgument], () => secretCompletion),
      secretCompletion,
    );
    const aggregate = aggregateSession(directory, token, (value) => value);
    assert.equal(aggregate.partial, true);
    assert.deepEqual(aggregate.records, []);
    assert.deepEqual(aggregate.failures, [{ code: "SESSION_PARTIAL", reason: "STORAGE_FAILURE" }]);
    const [markerName] = await readdir(path.join(directory, "failures"));
    assert.ok(markerName);
    const marker = await readFile(path.join(directory, "failures", markerName), "utf8");
    assert.equal(marker.includes(secretArgument), false);
    assert.equal(marker.includes(secretCompletion), false);
    assert.equal(marker.includes(token), false);
    assert.match(marker, /SESSION_PARTIAL/);
    assert.match(marker, /STORAGE_FAILURE/);

    // If even the value-free marker cannot be persisted, the wrapped behavior
    // still wins and no incomplete worker can become a candidate.
    await rm(path.join(directory, "failures"), { recursive: true, force: true });
    await writeFile(path.join(directory, "failures"), "blocked\n");
    assert.throws(
      () => observeCall(metadata, [secretArgument], () => { throw new Error(secretCompletion); }),
      /STORAGE_FAILURE_COMPLETION_SECRET/,
    );
    const failedMarker = await readFile(path.join(directory, "failures"), "utf8");
    assert.equal(failedMarker.includes(secretArgument), false);
    assert.equal(failedMarker.includes(secretCompletion), false);
  } finally {
    if (previousDirectory === undefined) delete process.env.REPLAYLOCK_SESSION_DIR;
    else process.env.REPLAYLOCK_SESSION_DIR = previousDirectory;
    if (previousToken === undefined) delete process.env.REPLAYLOCK_SESSION_TOKEN;
    else process.env.REPLAYLOCK_SESSION_TOKEN = previousToken;
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeCliProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-session-cli-"));
  await writeFile(path.join(project, "package-lock.json"), '{"lockfileVersion":3}\n');
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(
    path.join(project, "src", "capture.ts"),
    "/** @replaylock capture */\nexport function capture(value: number): number { return value; }\n",
  );
  return project;
}

function runSyntheticRecord(project, exitStatus, options = {}) {
  const script = `
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { registerSessionWorker } from ${JSON.stringify(sessionModuleUrl)};
const directory = process.env.REPLAYLOCK_SESSION_DIR;
const token = process.env.REPLAYLOCK_SESSION_TOKEN;
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, "handshake.json"), JSON.stringify({ token }) + "\\n");
const complete = registerSessionWorker(directory, token, "complete");
complete.writeCompleted({ ...${JSON.stringify(observation())}, token });
complete.close();
${options.partialWriter ? 'registerSessionWorker(directory, token, "incomplete");' : ""}
${options.diagnostic ? `writeFileSync(path.join(directory, "diagnostics-test.jsonl"), JSON.stringify({ code: "INVALID_POLICY", source: "src/input.ts", line: 1, column: 1, message: "transform failed" }) + "\\n");` : ""}
process.exitCode = ${exitStatus};
`;
  return spawnSync(process.execPath, [cliPath, "record", "--", process.execPath, "--input-type=module", "-e", script], {
    cwd: project,
    encoding: "utf8",
    env: scrubbedEnvironment(),
    timeout: 30_000,
  });
}

function observation() {
  return {
    locator: { module: "src/calculation.ts", exportName: "calculate" },
    arguments: [1],
    completion: { kind: "return", value: 2 },
    sourceGraphDigest: `sha256:${"c".repeat(64)}`,
    runtimeProfile: {
      node: "v22",
      vite: "8",
      vitest: "4",
      replaylock: "0.1.0",
      platform: process.platform,
      architecture: process.arch,
      timezone: "UTC",
      locale: "en",
    },
  };
}

async function candidateFiles(project) {
  try {
    return (await readdir(path.join(project, ".replaylock", "observations", "pending"))).filter(
      (name) => name.endsWith(".json"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function recursiveFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await recursiveFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}

function scrubbedEnvironment() {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return environment;
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
