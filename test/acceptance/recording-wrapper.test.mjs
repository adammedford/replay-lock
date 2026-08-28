import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateCandidateSessionRecord } from "../../dist/candidates.js";
import { observeCall } from "../../dist/runtime.js";
import { aggregateSession } from "../../dist/session.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitePath = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

test("recording activation is capability-gated for ordinary Vitest and production Vite", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function calculate(value: number): number { return value + 1; }
`,
    testSource: `import { calculate } from "../src/calculation.js";
test("ordinary", () => expect(calculate(2)).toBe(3));
`,
  });
  const invalidSession = path.join(project, "invalid-session");
  try {
    const ordinary = runVitest(project, {
      REPLAYLOCK_SESSION_DIR: invalidSession,
      REPLAYLOCK_SESSION_TOKEN: "guessable",
    });
    assert.equal(ordinary.status, 0, output(ordinary));
    assert.deepEqual(await entriesOrEmpty(invalidSession), []);

    await writeFile(path.join(project, "index.html"), '<script type="module" src="/src/main.ts"></script>\n');
    await writeFile(path.join(project, "src", "main.ts"), 'import { calculate } from "./calculation.js"; console.log(calculate(1));\n');
    const production = spawnSync(process.execPath, [vitePath, "build", "--config", "vitest.config.ts"], {
      cwd: project,
      encoding: "utf8",
      env: scrubbedEnvironment(),
      timeout: 30_000,
    });
    assert.equal(production.status, 0, output(production));
    assert.deepEqual(await entriesOrEmpty(path.join(project, ".replaylock")), []);

    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    assert.match(output(recorded), /Recorded 1 candidate\(s\)/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("instrumentation preserves supported call behavior without synthetic calls", async () => {
  const project = await makeProject({
    source: `let naturalCalls = 0;
export const calls = () => naturalCalls;

/** @replaylock capture */
export function safeAdd(left: number, right: number): number { return left + right; }

/** @replaylock capture */
export function recursive(value: number, total = 0): number {
  naturalCalls += 1;
  console.log("natural", value);
  return value === 0 ? total : recursive(value - 1, total + value);
}

/** @replaylock capture */
export function argumentCount(first: number): number { return arguments.length + first - first; }

/** @replaylock capture */
export function withThis(this: { base: number }, value: number): number { return this.base + value; }

/** @replaylock capture */
export function identity<T>(value: T): T { return value; }

/** @replaylock capture */
export function throwIdentity(value: unknown): never { throw value; }

/** @replaylock capture */
export const arrowIdentity = <T>(value: T): T => value;
`,
    testSource: `import { argumentCount, arrowIdentity, calls, identity, recursive, safeAdd, throwIdentity, withThis } from "../src/calculation.js";
import { expect, test, vi } from "vitest";

test("all observable call behavior", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  let evaluations = 0;
  const evaluate = () => { evaluations += 1; return 3; };
  expect(recursive(evaluate())).toBe(6);
  expect(safeAdd(20, 22)).toBe(42);
  expect(evaluations).toBe(1);
  expect(calls()).toBe(4);
  expect(log.mock.calls).toEqual([["natural", 3], ["natural", 2], ["natural", 1], ["natural", 0]]);
  expect(recursive.name).toBe("recursive");
  expect(recursive.length).toBe(1);
  expect(argumentCount(1, 2, 3)).toBe(3);
  expect(withThis.call({ base: 40 }, 2)).toBe(42);
  const returned = {};
  expect(identity(returned)).toBe(returned);
  expect(arrowIdentity(returned)).toBe(returned);
  const thrown = {};
  let caught;
  try { throwIdentity(thrown); } catch (error) { caught = error; }
  expect(caught).toBe(thrown);
});
`,
  });
  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /KNOWN_EFFECT src\/calculation\.ts:\d+:1/);
    const observations = await observationRecords(project);
    const recursive = observations.filter((entry) => entry.locator.exportName === "recursive");
    assert.equal(recursive.length, 0, "known-effect calls must never become durable captures");
    const safeRecords = observations.filter((entry) => entry.locator.exportName === "safeAdd");
    assert.throws(
      () => assertOneNaturalCall([...safeRecords, safeRecords[0]]),
      "the duplicate-observation positive control must prove the assertion can fail",
    );
    assertOneNaturalCall(safeRecords);
    assert.deepEqual(
      observations.find((entry) => entry.locator.exportName === "safeAdd")?.arguments,
      [20, 22],
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("composed source maps retain authored failure locations", async () => {
  const authoredLine = 6;
  const project = await makeProject({
    source: `/**
 * @replaylock capture
 * @replaylock assume-pure reviewed local Error construction
 */
export function authoredFailure(): never {
  throw new Error("AUTHORED_FAILURE");
}
`,
    testSource: `import { authoredFailure } from "../src/calculation.js";
test("shows authored stack", () => authoredFailure());
`,
  });
  try {
    const result = runRecord(project);
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /AUTHORED_FAILURE/);
    assert.match(output(result), new RegExp(`src/calculation\\.ts:${authoredLine}:9`));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("Promise and thenable completions pass through unobserved", async () => {
  const project = await makeProject({
    source: `export let propertyReads = 0;
const promise = Promise.resolve(1);
const thenable = new Proxy({}, { get() { propertyReads += 1; throw new Error("thenable inspected"); } });
/** @replaylock capture */
export function promiseIdentity(): Promise<number> { return promise; }
/** @replaylock capture */
export function thenableIdentity(): object { return thenable; }
`,
    testSource: `import { promiseIdentity, propertyReads, thenableIdentity } from "../src/calculation.js";
test("identity and no assimilation", () => {
  const promise = promiseIdentity();
  expect(promiseIdentity()).toBe(promise);
  const thenable = thenableIdentity();
  expect(thenableIdentity()).toBe(thenable);
  expect(propertyReads).toBe(0);
});
`,
  });
  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /KNOWN_EFFECT/);
    assert.match(output(result), /^NO_ELIGIBLE_TARGET:/m);
    assert.doesNotMatch(output(result), /Recorded 0 candidate\(s\)/);
    assert.deepEqual(await observationRecords(project), []);

    const session = await mkdtemp(path.join(os.tmpdir(), "replaylock-thenable-runtime-"));
    const previousDirectory = process.env.REPLAYLOCK_SESSION_DIR;
    const previousToken = process.env.REPLAYLOCK_SESSION_TOKEN;
    process.env.REPLAYLOCK_SESSION_DIR = session;
    process.env.REPLAYLOCK_SESSION_TOKEN = "a".repeat(64);
    try {
      const metadata = {
        locator: { module: "src/direct.ts", exportName: "completion" },
        sourceGraphDigest: `sha256:${"b".repeat(64)}`,
      };
      const promise = Promise.resolve(1);
      const ownThenable = { then() {} };
      const inheritedThenable = Object.create({ then() {} });
      let accessorReads = 0;
      const accessorThenable = {};
      Object.defineProperty(accessorThenable, "then", {
        get() { accessorReads += 1; return () => {}; },
      });
      let proxyTraps = 0;
      const proxy = new Proxy({}, {
        get() { proxyTraps += 1; throw new Error("get trap invoked"); },
        getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("descriptor trap invoked"); },
        getPrototypeOf() { proxyTraps += 1; throw new Error("prototype trap invoked"); },
        ownKeys() { proxyTraps += 1; throw new Error("keys trap invoked"); },
      });

      for (const completion of [promise, ownThenable, inheritedThenable, accessorThenable]) {
        assert.equal(observeCall(metadata, [], () => completion), completion);
      }
      assert.equal(observeCall(metadata, [], () => proxy), proxy);
      assert.equal(accessorReads, 0);
      assert.equal(proxyTraps, 0);

      const aggregated = aggregateSession(session, "a".repeat(64), validateCandidateSessionRecord);
      assert.deepEqual(aggregated.failures, []);
      assert.equal(aggregated.records.filter((record) => record.state === "observation").length, 0);
      assert.deepEqual(
        aggregated.records.filter((record) => record.state === "blocked").map((record) => record.block),
        [{
          code: "UNSUPPORTED_VALUE",
          locator: metadata.locator,
          safePath: "$completion",
        }],
      );
    } finally {
      if (previousDirectory === undefined) delete process.env.REPLAYLOCK_SESSION_DIR;
      else process.env.REPLAYLOCK_SESSION_DIR = previousDirectory;
      if (previousToken === undefined) delete process.env.REPLAYLOCK_SESSION_TOKEN;
      else process.env.REPLAYLOCK_SESSION_TOKEN = previousToken;
      await rm(session, { recursive: true, force: true });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("zero-invocation handshake differs from missing plugin", async () => {
  const active = await makeProject({
    source: `/** @replaylock capture */
export function untouched(value: number): number { return value; }
`,
    testSource: `test("does not invoke", () => expect(true).toBe(true));\n`,
  });
  const missing = await makeProject({
    source: `/** @replaylock capture */
export function untouched(value: number): number { return value; }
`,
    testSource: `test("passes", () => expect(true).toBe(true));\n`,
    plugin: false,
  });
  try {
    const zero = runRecord(active);
    assert.equal(zero.status, 0, output(zero));
    assert.match(output(zero), /Recorded 0 candidate\(s\)/);
    assert.doesNotMatch(output(zero), /PLUGIN_NOT_ACTIVE/);

    const absent = runRecord(missing);
    assert.equal(absent.status, 2, output(absent));
    assert.match(output(absent), /^PLUGIN_NOT_ACTIVE:/m);
    assert.doesNotMatch(output(absent), /Recorded 0 candidate/);
  } finally {
    await Promise.all([
      rm(active, { recursive: true, force: true }),
      rm(missing, { recursive: true, force: true }),
    ]);
  }
});

test("wrapped command failure remains primary while ReplayLock failure is separate", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function value(input: number): number { return input; }
`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  try {
    const result = runCli(project, [
      "record",
      "--",
      process.execPath,
      "-e",
      'console.log("WRAPPED_OUTPUT"); process.exit(7)',
    ]);
    assert.equal(result.status, 7, output(result));
    assert.match(output(result), /WRAPPED_OUTPUT/);
    assert.match(output(result), /^PLUGIN_NOT_ACTIVE:/m);
    assert.match(output(result), /Wrapped command exited with status 7/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("record preflight never launches the wrapped command without a capture target", async () => {
  const project = await makeProject({
    source: `export const value = 1;\n`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  const sentinel = path.join(project, "business-executed");
  try {
    const result = runCli(project, [
      "record", "--", process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed")`,
    ]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /^NO_CAPTURE_TARGET:/m);
    await assert.rejects(readFile(sentinel), (error) => error?.code === "ENOENT");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("record preflight never launches the wrapped command when every target is blocked", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function effectful(): number { return Date.now(); }
`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  const sentinel = path.join(project, "business-executed");
  try {
    const result = runCli(project, [
      "record", "--", process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed")`,
    ]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /KNOWN_EFFECT/);
    assert.match(output(result), /^NO_ELIGIBLE_TARGET:/m);
    await assert.rejects(readFile(sentinel), (error) => error?.code === "ENOENT");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a known effect contradicting assume-pure is an assertion conflict before execution", async () => {
  const project = await makeProject({
    source: `/**
 * @replaylock capture
 * @replaylock assume-pure reviewed clock access
 */
export function effectful(): number { return Date.now(); }
`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  const sentinel = path.join(project, "business-executed");
  try {
    const result = runCli(project, [
      "record", "--", process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed")`,
    ]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /ASSERTION_CONFLICT src\/calculation\.ts/);
    assert.match(output(result), /^NO_ELIGIBLE_TARGET:/m);
    await assert.rejects(readFile(sentinel), (error) => error?.code === "ENOENT");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("invalid adapter configuration stops before the wrapped command", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function eligible(value: number): number { return value + 1; }
`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  const sentinel = path.join(project, "business-executed");
  try {
    await writeFile(
      path.join(project, "replaylock.config.ts"),
      `export default { valueAdapters: [{}] };\n`,
    );
    const result = runCli(project, [
      "record", "--", process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed")`,
    ]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /^VALUE_ADAPTER_INVALID VALUE_ADAPTER_REGISTRY_FAILED/m);
    await assert.rejects(readFile(sentinel), (error) => error?.code === "ENOENT");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("record setup write failures use the stable store diagnostic before execution", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function eligible(value: number): number { return value + 1; }
`,
    testSource: `test("unused", () => expect(true).toBe(true));\n`,
  });
  const sentinel = path.join(project, "business-executed");
  try {
    await writeFile(path.join(project, ".replaylock"), "blocks the store directory");
    const result = runCli(project, [
      "record", "--", process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed")`,
    ]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /^STORE_WRITE_FAILED SESSION_SETUP_FAILED:/m);
    await assert.rejects(readFile(sentinel), (error) => error?.code === "ENOENT");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("pending artifact write failures use the stable store diagnostic", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function eligible(value: number): number { return value + 1; }
`,
    testSource: `import { eligible } from "../src/calculation.js";
test("natural", () => expect(eligible(1)).toBe(2));\n`,
  });
  try {
    await mkdir(path.join(project, ".replaylock", "observations"), { recursive: true });
    await writeFile(path.join(project, ".replaylock", "observations", "pending"), "blocks pending writes");
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(
      output(result),
      /^STORE_WRITE_FAILED SESSION_PARTIAL: SESSION_PERSIST_FAILED/m,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function makeProject({ source, testSource, plugin = true }) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-wrapper-"));
  await cp(fixtureRoot, project, { recursive: true });
  await writeFile(path.join(project, "src", "calculation.ts"), source);
  await writeFile(path.join(project, "test", "calculation.test.ts"), testSource);
  if (!plugin) {
    await writeFile(
      path.join(project, "vitest.config.ts"),
      'export default { test: { globals: true, include: ["test/**/*.test.ts"] } };\n',
    );
  }
  const nodeModules = path.join(project, "node_modules");
  await mkdir(nodeModules);
  await symlink(repositoryRoot, path.join(nodeModules, "replaylock"), process.platform === "win32" ? "junction" : "dir");
  return project;
}

function runRecord(project) {
  return runCli(project, ["record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"]);
}

function runVitest(project, environment = {}) {
  return spawnSync(process.execPath, [vitestPath, "run", "--config", "vitest.config.ts"], {
    cwd: project,
    encoding: "utf8",
    env: { ...scrubbedEnvironment(), ...environment },
    timeout: 30_000,
  });
}

function runCli(project, arguments_) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: project,
    encoding: "utf8",
    env: scrubbedEnvironment(),
    timeout: 30_000,
  });
}

function scrubbedEnvironment() {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return environment;
}

async function observationRecords(project) {
  const sessionsRoot = path.join(project, ".replaylock", "observations", "sessions");
  const records = [];
  for (const session of await entriesOrEmpty(sessionsRoot)) {
    const workersDirectory = path.join(sessionsRoot, session, "workers");
    for (const worker of await entriesOrEmpty(workersDirectory)) {
      const chunksDirectory = path.join(workersDirectory, worker, "chunks");
      const chunks = (await entriesOrEmpty(chunksDirectory)).filter((name) =>
        name.endsWith(".complete.json"),
      );
      for (const chunk of chunks) {
        const envelope = JSON.parse(await readFile(path.join(chunksDirectory, chunk), "utf8"));
        records.push(envelope.record);
      }
    }
  }
  return records;
}

function assertOneNaturalCall(records) {
  assert.equal(records.length, 1, "only the one durable natural call may be observed");
}

async function entriesOrEmpty(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
