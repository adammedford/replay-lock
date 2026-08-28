import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "core");
const cli = path.join(root, "dist", "cli.js");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

test("recording adapter failure isolation verified", async () => {
  const project = await projectFor("identity", { serializeBody: `throw new Error("SERIALIZER_SECRET");` });
  try {
    await addSafeTarget(project);
    const result = record(project);
    assert.equal(result.status, 0, out(result));
    assert.match(out(result), /VALUE_ADAPTER_SERIALIZE_FAILED/);
    assert.doesNotMatch(out(result), /SERIALIZER_SECRET/);
    assert.match(out(result), /Recorded 1 candidate\(s\)/);
    assert.equal((await jsonFiles(path.join(project, ".replaylock", "observations", "pending"))).length, 1);
  } finally { await rm(project, { recursive: true, force: true }); }

  const timed = await projectFor("identity", { deserializeBody: "while (true) {}" });
  try {
    await addSafeTarget(timed);
    const result = record(timed);
    assert.equal(result.status, 0, out(result));
    assert.match(out(result), /VALUE_ADAPTER_VALIDATION_TIMEOUT/);
    assert.match(out(result), /Recorded 1 candidate\(s\)/);
  } finally { await rm(timed, { recursive: true, force: true }); }
});

test("adapter evolution preflight verified", async () => {
  const project = await projectFor("identity");
  try {
    await accept(project);
    await config(project, { adapters: false });
    const result = run(project, ["verify"]);
    assert.equal(result.status, 2, out(result));
    assert.match(out(result), /VALUE_ADAPTER_MISSING VALUE_ADAPTER_LOOKUP_FAILED/);

    await config(project, { version: 2 });
    const incompatible = run(project, ["verify"]);
    assert.equal(incompatible.status, 2, out(incompatible));
    assert.match(out(incompatible), /VALUE_ADAPTER_VERSION_MISMATCH VALUE_ADAPTER_LOOKUP_FAILED/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("completion adapter failure verified", async () => {
  const project = await projectFor("completion");
  try {
    await accept(project);
    await config(project, {
      configPrelude: `const reconstructed = new WeakSet<Money>();`,
      serializeBody: `if (!reconstructed.has(value)) { process.stdout.write("COMPLETION_OUTPUT_SECRET"); process.stderr.write("COMPLETION_ERROR_SECRET"); throw new Error("COMPLETION_SECRET"); } return { cents: value.cents };`,
      deserializeBody: `const value = Money.fromCents((payload as { cents: number }).cents); reconstructed.add(value); return value;`,
    });
    const result = run(project, ["verify"]);
    assert.equal(result.status, 1, out(result));
    assert.match(out(result), /VALUE_ADAPTER_SERIALIZE_FAILED/);
    assert.doesNotMatch(out(result), /COMPLETION_SECRET|COMPLETION_OUTPUT_SECRET|COMPLETION_ERROR_SECRET/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("adapter refactor stability verified", async () => {
  const project = await projectFor("identity");
  try {
    await accept(project);
    await mkdir(path.join(project, "src", "domain"));
    await writeFile(path.join(project, "src", "domain", "money.ts"), moneySource(true));
    await rm(path.join(project, "src", "money.ts"));
    await source(project, "identity", "./domain/money.js");
    await config(project, { classImport: "./src/domain/money.js" });
    const result = run(project, ["verify"]);
    assert.equal(result.status, 0, out(result));
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("argument adapter evolution verified", async () => {
  const project = await projectFor("identity");
  try {
    const oldPath = await accept(project);
    const oldName = path.basename(oldPath);
    await config(project, { version: 2 });
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    const pending = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    assert.equal(pending.length, 1);
    assert.notEqual(pending[0], oldName, "argument wire version must change case identity");
    assert.equal(run(project, ["review"], "a\n").status, 0);
    assert.equal((await jsonFiles(path.join(project, ".replaylock", "cases"))).length, 2);
    await rm(oldPath);
    assert.equal(run(project, ["verify"]).status, 0);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test("completion adapter evolution verified", async () => {
  const project = await projectFor("completion");
  try {
    const oldPath = await accept(project);
    const oldBytes = await readFile(oldPath);
    await config(project, { version: 2 });
    const recorded = record(project);
    assert.equal(recorded.status, 0, out(recorded));
    const [pendingName] = await jsonFiles(path.join(project, ".replaylock", "observations", "pending"));
    assert.equal(pendingName, path.basename(oldPath), "completion-only version keeps input identity");
    const pending = JSON.parse(await readFile(path.join(project, ".replaylock", "observations", "pending", pendingName), "utf8"));
    assert.equal(pending.replacesCaseId, pending.caseId);
    const skipped = run(project, ["review"], "s\n");
    assert.match(out(skipped), /Replacement diff/);
    assert.match(out(skipped), /"version": 1|"version":1/);
    assert.match(out(skipped), /"version": 2|"version":2/);
    assert.deepEqual(await readFile(oldPath), oldBytes);
    const accepted = run(project, ["review"], "a\n");
    assert.equal(accepted.status, 0, out(accepted));
    assert.notDeepEqual(await readFile(oldPath), oldBytes);
    assert.equal(run(project, ["verify"]).status, 0);
  } finally { await rm(project, { recursive: true, force: true }); }
});

async function projectFor(mode, options = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-adapter-evolution-"));
  await cp(fixture, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(root, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "src", "money.ts"), moneySource(false));
  await source(project, mode, "./money.js");
  await writeFile(path.join(project, "test", "calculation.test.ts"), mode === "identity" ? `
import { identity } from "../src/calculation.js"; import { Money } from "../src/money.js";
test("identity", () => { const value = Money.fromCents(100); expect(identity(value)).toBe(1); });
` : `
import { completion } from "../src/calculation.js";
test("completion", () => expect(completion(100).cents).toBe(125));
`);
  await config(project, options);
  return project;
}

function moneySource(privateField) {
  return privateField
    ? `export class Money { #amount: number; private constructor(cents: number) { this.#amount = cents; } static fromCents(cents: number): Money { return new Money(cents); } get cents(): number { return this.#amount; } }`
    : `export class Money { private constructor(readonly cents: number) {} static fromCents(cents: number): Money { return new Money(cents); } }`;
}

async function source(project, mode, classImport) {
  await writeFile(path.join(project, "src", "calculation.ts"), mode === "identity" ? `
import { Money } from ${JSON.stringify(classImport)};
/** @replaylock capture */
export function identity(_value: Money): number { return 1; }
` : `
import { Money } from "./money.js";
/**\n * @replaylock capture\n * @replaylock assume-pure reviewed domain construction\n */
export function completion(cents: number): Money { return Money.fromCents(cents + 25); }
`);
}

async function config(project, options = {}) {
  if (options.adapters === false) {
    await writeFile(path.join(project, "replaylock.config.ts"), `import { defineReplayLock } from "replaylock"; export default defineReplayLock();\n`);
    return;
  }
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock, defineValueAdapter } from "replaylock";
import { Money } from ${JSON.stringify(options.classImport ?? "./src/money.js")};
${options.configPrelude ?? ""}
export default defineReplayLock({ valueAdapters: [defineValueAdapter({
  type: Money, id: "example.money", version: ${options.version ?? 1},
  serialize(value: Money) { ${options.serializeBody ?? "return { cents: value.cents };"} },
  deserialize(payload: unknown) { ${options.deserializeBody ?? "return Money.fromCents((payload as { cents: number }).cents);"} },
})] });
`);
}

async function addSafeTarget(project) {
  await writeFile(path.join(project, "src", "safe.ts"), `/** @replaylock capture */\nexport function safe(value: number): number { return value + 1; }\n`);
  await writeFile(path.join(project, "test", "safe.test.ts"), `import { safe } from "../src/safe.js"; test("safe", () => expect(safe(1)).toBe(2));\n`);
}

async function accept(project) {
  const recorded = record(project); assert.equal(recorded.status, 0, out(recorded)); assert.match(out(recorded), /Recorded 1 candidate\(s\)/);
  const reviewed = run(project, ["review"], "a\n"); assert.equal(reviewed.status, 0, out(reviewed));
  const [name] = await jsonFiles(path.join(project, ".replaylock", "cases")); assert.ok(name);
  return path.join(project, ".replaylock", "cases", name);
}

function record(project) { return run(project, ["record", "--", process.execPath, vitest, "run", "--config", "vitest.config.ts"]); }
function run(project, args, input) {
  const env = { ...process.env }; delete env.REPLAYLOCK_SESSION_DIR; delete env.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cli, ...args], { cwd: project, encoding: "utf8", env, input, timeout: 30_000 });
}
async function jsonFiles(directory) { try { return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort(); } catch (error) { if (error?.code === "ENOENT") return []; throw error; } }
function out(result) { return `${result.stdout ?? ""}${result.stderr ?? ""}`; }
