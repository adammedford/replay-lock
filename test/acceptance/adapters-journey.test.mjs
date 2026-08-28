import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

test("one configured domain adapter completes the adapted characterization journey", async () => {
  const project = await makeProject(false);
  try {
    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    assert.match(output(recorded), /Recorded 1 candidate\(s\)/);

    const pendingDirectory = path.join(project, ".replaylock", "observations", "pending");
    const [pendingName] = await jsonFiles(pendingDirectory);
    assert.ok(pendingName, "the natural adapted call must create one pending candidate");
    const pending = JSON.parse(await readFile(path.join(pendingDirectory, pendingName), "utf8"));
    assertAdaptedNodes(pending);

    const review = runCli(project, ["review"], "a\n");
    assert.equal(review.status, 0, output(review));
    assert.match(output(review), /Canonical input:/);
    assert.match(output(review), /"adapterId":"example\.money"/);
    assert.match(output(review), /"version":1/);
    assert.match(output(review), /"cents"/);
    assert.doesNotMatch(output(review), /constructor|private|Money/);

    const [caseName] = await jsonFiles(path.join(project, ".replaylock", "cases"));
    assert.ok(caseName, "explicit acceptance must create one case");
    const casePath = path.join(project, ".replaylock", "cases", caseName);
    const acceptedBytes = await readFile(casePath);
    const accepted = JSON.parse(acceptedBytes.toString("utf8"));
    assertAdaptedNodes(accepted);

    const verified = runCli(project, ["verify"]);
    assert.equal(verified.status, 0, output(verified));
    assert.match(output(verified), /Verified 1 case\(s\)/);
    assert.deepEqual(await readFile(casePath), acceptedBytes, "verification changed the accepted adapter case");

    const sessionRecords = await completedSessionRecords(project);
    assert.equal(sessionRecords.length, 1, "the natural target should be observed exactly once");
    const targetProof = JSON.parse(await readFile(path.join(project, "target-proof.json"), "utf8"));
    assert.deepEqual(targetProof, { calls: 1, deserializationsDuringRecording: 0 });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("adapter registration changes encodability but cannot erase purity evidence", async () => {
  const project = await makeProject(true);
  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /KNOWN_EFFECT/);
    assert.equal((await jsonFiles(path.join(project, ".replaylock", "observations", "pending"))).length, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function makeProject(effectful) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-adapter-"));
  await cp(fixtureRoot, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(repositoryRoot, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "src", "money.ts"), `
let deserializations = 0;
export class Money {
  private constructor(readonly cents: number) {}
  static fromCents(cents: number): Money { return new Money(cents); }
}
export function noteDeserialization(): void { deserializations += 1; }
export function deserializationCount(): number { return deserializations; }
`);
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock, defineValueAdapter } from "replaylock";
import { Money, noteDeserialization } from "./src/money.js";

const money = defineValueAdapter({
  type: Money,
  id: "example.money",
  version: 1,
  serialize(value: Money) { return { cents: value.cents }; },
  deserialize(payload: unknown) {
    noteDeserialization();
    if (!payload || typeof payload !== "object" || typeof (payload as { cents?: unknown }).cents !== "number") {
      throw new TypeError("invalid money payload");
    }
    return Money.fromCents((payload as { cents: number }).cents);
  },
});

export default defineReplayLock({ valueAdapters: [money] });
`);
  const body = effectful
    ? "return Money.fromCents(value.cents + Math.random());"
    : "return Money.fromCents(value.cents + 25);";
  const policy = effectful
    ? "/** @replaylock capture */"
    : `/**\n * @replaylock capture\n * @replaylock assume-pure reviewed domain-value access\n */`;
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { Money } from "./money.js";
${policy}
export function addFee(value: Money): Money { ${body} }
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { writeFileSync } from "node:fs";
import { addFee } from "../src/calculation.js";
import { Money, deserializationCount } from "../src/money.js";

test("natural domain calculation", () => {
  const original = Money.fromCents(100);
  const result = addFee(original);
  ${effectful ? "expect(Number.isFinite(result.cents)).toBe(true);" : "expect(result.cents).toBe(125);"}
  writeFileSync("target-proof.json", JSON.stringify({
    calls: 1,
    deserializationsDuringRecording: deserializationCount(),
  }));
});
`);
  return project;
}

function runRecord(project) {
  return runCli(project, ["record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"]);
}

function runCli(project, arguments_, input) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: project,
    encoding: "utf8",
    env: environment,
    input,
    timeout: 30_000,
  });
}

function assertAdaptedNodes(artifact) {
  const nodes = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "adapted") nodes.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(artifact.arguments);
  visit(artifact.completion);
  assert.equal(nodes.length, 2, "argument and completion must both be adapted");
  for (const node of nodes) {
    assert.deepEqual(Object.keys(node).sort(), ["adapterId", "kind", "payload", "version"]);
    assert.equal(node.adapterId, "example.money");
    assert.equal(node.version, 1);
    assert.equal(node.payload.kind, "record");
  }
  assert.doesNotMatch(JSON.stringify(nodes), /constructor|private|Money/);
}

async function completedSessionRecords(project) {
  const sessionsRoot = path.join(project, ".replaylock", "observations", "sessions");
  const records = [];
  for (const session of await entriesOrEmpty(sessionsRoot)) {
    for (const worker of await entriesOrEmpty(path.join(sessionsRoot, session, "workers"))) {
      const chunks = path.join(sessionsRoot, session, "workers", worker, "chunks");
      for (const filename of await entriesOrEmpty(chunks)) {
        if (!filename.endsWith(".complete.json")) continue;
        records.push(JSON.parse(await readFile(path.join(chunks, filename), "utf8")).record);
      }
    }
  }
  return records;
}

async function jsonFiles(directory) {
  return (await entriesOrEmpty(directory)).filter((name) => name.endsWith(".json")).sort();
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
