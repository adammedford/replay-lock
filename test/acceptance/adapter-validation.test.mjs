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

test("adapter entry validation verified", async () => {
  for (const { serializeBody, diagnostic } of [
    {
      serializeBody: `return { apiKey: "ENTRY_SECRET_MUST_NOT_LEAK" };`,
      diagnostic: /SENSITIVE_VALUE/,
    },
    {
      serializeBody: `let payloadValue: unknown = {}; for (let index = 0; index < 30; index += 1) payloadValue = { nested: payloadValue }; return payloadValue as never;`,
      diagnostic: /OVERSIZED_OBSERVATION/,
    },
    {
      serializeBody: `return undefined as never;`,
      diagnostic: /VALUE_ADAPTER_PAYLOAD_UNSUPPORTED/,
    },
  ]) {
    const project = await makeProject({ serializeBody, targetBody: "return value;" });
    try {
      const result = runRecord(project);
      assert.equal(result.status, 0, output(result));
      assert.match(output(result), diagnostic);
      assert.doesNotMatch(output(result), /ENTRY_SECRET_MUST_NOT_LEAK/);
      const proof = JSON.parse(await readFile(path.join(project, "proof.json"), "utf8"));
      assert.deepEqual(proof, { sameIdentity: true, serializations: 1, deserializations: 0 });
      assert.equal((await entriesOrEmpty(path.join(project, ".replaylock", "observations", "pending"))).length, 0);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test("adapter entry preservation verified", async () => {
  const project = await makeProject({
    serializeBody: `throw new Error("ENTRY_THROW_SECRET_MUST_NOT_LEAK");`,
    targetBody: "return value;",
  });
  try {
    const result = runRecord(project);
    assert.equal(result.status, 0, output(result));
    assert.doesNotMatch(output(result), /ENTRY_THROW_SECRET_MUST_NOT_LEAK/);
    const proof = JSON.parse(await readFile(path.join(project, "proof.json"), "utf8"));
    assert.deepEqual(proof, { sameIdentity: true, serializations: 1, deserializations: 0 });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("isolated adapter validation verified", async () => {
  const project = await makeProject({
    deserializeBody: "return Money.fromCents((payload as { cents: number }).cents + 1);",
  });
  try {
    const result = runRecord(project);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /VALUE_ADAPTER_ROUNDTRIP_MISMATCH/);
    assert.match(output(result), /VALUE_ADAPTER_BLOCK/);
    assert.equal((await entriesOrEmpty(path.join(project, ".replaylock", "observations", "pending"))).length, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("safe adapter diagnostics verified", async (context) => {
  const cases = [
    {
      body: `process.stdout.write("VALIDATOR_OUTPUT_SECRET"); process.stderr.write("VALIDATOR_ERROR_SECRET"); throw new Error("VALIDATOR_THROW_SECRET");`,
      code: "VALUE_ADAPTER_DESERIALIZE_FAILED",
    },
    {
      body: "return {} as Money;",
      code: "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH VALUE_ADAPTER_PROTOTYPE_MISMATCH",
    },
    { body: "while (true) {}", code: "VALUE_ADAPTER_VALIDATION_TIMEOUT" },
  ];
  for (const fixture of cases) {
    const project = await makeProject({ deserializeBody: fixture.body });
    try {
      // The whole CLI also loads configuration and runs Vitest; its deadline is
      // distinct from the unchanged five-second isolated-validator safety limit.
      const started = performance.now();
      const result = runRecord(project);
      context.diagnostic(`${fixture.code}: complete CLI took ${Math.round(performance.now() - started)}ms`);
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${fixture.code}: ${output(result)}`);
      assert.match(output(result), new RegExp(fixture.code));
      assert.doesNotMatch(output(result), /VALIDATOR_OUTPUT_SECRET|VALIDATOR_ERROR_SECRET|VALIDATOR_THROW_SECRET/);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test("adapter replay preflight verified", async () => {
  const project = await makeProject();
  try {
    acceptOne(project);
    await writeConfiguration(project, {
      deserializeBody: `if (process.env.REPLAYLOCK_CLI_PID) { process.stdout.write("REPLAY_DECODE_OUTPUT_SECRET"); process.stderr.write("REPLAY_DECODE_ERROR_SECRET"); throw new Error("REPLAY_DECODE_THROW_SECRET"); } return Money.fromCents((payload as { cents: number }).cents);`,
    });
    const result = runCli(project, ["verify"]);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /VALUE_ADAPTER_DESERIALIZE_FAILED/);
    assert.doesNotMatch(output(result), /REPLAY_DECODE_OUTPUT_SECRET|REPLAY_DECODE_ERROR_SECRET|REPLAY_DECODE_THROW_SECRET/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("adapted completion comparison verified", async () => {
  const project = await makeProject();
  try {
    const casePath = await acceptOne(project);
    const accepted = await readFile(casePath);
    assert.equal(runCli(project, ["verify"]).status, 0);
    await writeConfiguration(project, {
      configPrelude: `const reconstructed = new WeakSet<Money>();`,
      serializeBody: `return { cents: value.cents + (reconstructed.has(value) ? 0 : 1) };`,
      deserializeBody: `const value = Money.fromCents((payload as { cents: number }).cents); reconstructed.add(value); return value;`,
    });
    const mismatch = runCli(project, ["verify"]);
    assert.equal(mismatch.status, 1, output(mismatch));
    assert.match(output(mismatch), /OUTPUT_MISMATCH/);
    assert.deepEqual(await readFile(casePath), accepted);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function makeProject(options = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-adapter-validation-"));
  await cp(fixtureRoot, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(repositoryRoot, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "src", "money.ts"), `
let serializations = 0;
let deserializations = 0;
export class Money {
  private constructor(readonly cents: number) {}
  static fromCents(cents: number): Money { return new Money(cents); }
}
export function noteSerialization(): void { serializations += 1; }
export function noteDeserialization(): void { deserializations += 1; }
export function counts(): { serializations: number; deserializations: number } { return { serializations, deserializations }; }
`);
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { Money } from "./money.js";
/**
 * @replaylock capture
 * @replaylock assume-pure reviewed domain-value access
 */
export function calculate(value: Money): Money { ${options.targetBody ?? "return Money.fromCents(value.cents + 25);"} }
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { writeFileSync } from "node:fs";
import { calculate } from "../src/calculation.js";
import { Money, counts } from "../src/money.js";
test("natural adapted call", () => {
  const original = Money.fromCents(100);
  const result = calculate(original);
  expect(result.cents).toBe(${options.targetBody ? "100" : "125"});
  writeFileSync("proof.json", JSON.stringify({ sameIdentity: result === original, ...counts() }));
});
`);
  await writeConfiguration(project, options);
  return project;
}

async function writeConfiguration(project, options = {}) {
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock, defineValueAdapter } from "replaylock";
import { Money, noteSerialization, noteDeserialization } from "./src/money.js";
${options.configPrelude ?? ""}
const money = defineValueAdapter({
  type: Money,
  id: "example.money",
  version: ${options.version ?? 1},
  serialize(value: Money) {
    noteSerialization();
    ${options.serializeBody ?? "return { cents: value.cents };"}
  },
  deserialize(payload: unknown) {
    noteDeserialization();
    ${options.deserializeBody ?? "return Money.fromCents((payload as { cents: number }).cents);"}
  },
});
export default defineReplayLock({ valueAdapters: [money] });
`);
}

async function acceptOne(project) {
  const recorded = runRecord(project);
  assert.equal(recorded.status, 0, output(recorded));
  assert.match(output(recorded), /Recorded 1 candidate\(s\)/);
  const reviewed = runCli(project, ["review"], "a\n");
  assert.equal(reviewed.status, 0, output(reviewed));
  const [filename] = (await entriesOrEmpty(path.join(project, ".replaylock", "cases"))).filter((name) => name.endsWith(".json"));
  assert.ok(filename);
  return path.join(project, ".replaylock", "cases", filename);
}

function runRecord(project, timeout = 30_000) {
  return runCli(project, ["record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"], undefined, timeout);
}

function runCli(project, arguments_, input, timeout = 30_000) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: project, encoding: "utf8", env: environment, input, timeout,
  });
}

async function entriesOrEmpty(directory) {
  try { return (await readdir(directory)).sort(); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
