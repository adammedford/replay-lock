import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

import {
  ValueAdapterConfigurationError,
  createValueAdapterRegistry,
  defineReplayLock,
  defineValueAdapter,
} from "../../dist/adapters.js";
import { CanonicalLimitError, UnsupportedValueError, encodeCanonicalValue } from "../../dist/canonical.js";
import { classifyObservation } from "../../dist/observation-safety.js";
import {
  findProjectConfiguration,
  findProjectConfigurationSync,
} from "../../dist/project-configuration.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

function adapter(type, id = "example.value", overrides = {}) {
  return defineValueAdapter({
    type,
    id,
    version: 1,
    serialize: () => ({ value: 1 }),
    deserialize: () => Object.create(type.prototype),
    ...overrides,
  });
}

function registry(...adapters) {
  return createValueAdapterRegistry(defineReplayLock({ valueAdapters: adapters }));
}

function assertConfigurationCode(operation, code) {
  assert.throws(operation, (error) =>
    error instanceof ValueAdapterConfigurationError && error.code === code);
}

test("project configuration discovery uses identical regular-file semantics", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-config-discovery-"));
  try {
    await mkdir(path.join(project, "replaylock.config.ts"));
    const fallback = path.join(project, "replaylock.config.cjs");
    await writeFile(fallback, "module.exports = {};\n");
    assert.equal(await findProjectConfiguration(project), fallback);
    assert.equal(findProjectConfigurationSync(project), fallback);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("realm local adapter registry verified", async () => {
  class LocalValue {}
  const configured = adapter(LocalValue);
  const first = registry(configured);
  const second = registry(configured);
  assert.notEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.adapters));
  assert.ok(Object.isFrozen(second) && Object.isFrozen(second.adapters));
  assert.equal(first.findForValue(new LocalValue())?.id, "example.value");

  const foreign = vm.runInNewContext("class Value {}; new Value()", Object.create(null));
  assert.equal(first.findForValue(foreign), undefined, "a cross-realm prototype must not match");

  const project = await realmProject();
  try {
    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    const proofs = await Promise.all(["a", "b"].map(async (name) =>
      JSON.parse(await readFile(path.join(project, `realm-${name}.json`), "utf8"))));
    assert.deepEqual(proofs, [
      { frozen: true, adaptersFrozen: true, matched: "example.money" },
      { frozen: true, adaptersFrozen: true, matched: "example.money" },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("adapter registration diagnostics verified", async () => {
  class A {}
  class B {}
  const invalid = [
    [() => registry(adapter(A, "plain")), "VALUE_ADAPTER_ID_INVALID"],
    [() => registry(adapter(A, "example.a", { version: 0 })), "VALUE_ADAPTER_VERSION_INVALID"],
    [() => registry(adapter(new Proxy(A, {}), "example.a")), "VALUE_ADAPTER_TOKEN_INVALID"],
    [() => registry(adapter(Object, "example.object")), "VALUE_ADAPTER_BUILTIN_PROTOTYPE"],
    [() => registry(adapter(A, "example.same"), adapter(B, "example.same")), "VALUE_ADAPTER_ID_DUPLICATE"],
    [() => registry(adapter(A, "example.a"), adapter(A, "example.b")), "VALUE_ADAPTER_PROTOTYPE_DUPLICATE"],
  ];
  for (const [operation, code] of invalid) assertConfigurationCode(operation, code);

  const project = await invalidProject();
  try {
    const first = runRecord(project);
    const second = runRecord(project);
    for (const result of [first, second]) {
      assert.equal(result.status, 2, output(result));
      assert.match(
        output(result),
        /VALUE_ADAPTER_INVALID VALUE_ADAPTER_REGISTRY_FAILED VALUE_ADAPTER_ID_INVALID/,
      );
    }

    await writeFile(path.join(project, "replaylock.config.ts"), invalidConfiguration("id-conflict"));
    const idConflict = runRecord(project);
    assert.equal(idConflict.status, 2, output(idConflict));
    assert.match(
      output(idConflict),
      /VALUE_ADAPTER_ID_CONFLICT VALUE_ADAPTER_REGISTRY_FAILED VALUE_ADAPTER_ID_DUPLICATE/,
    );

    await writeFile(path.join(project, "replaylock.config.ts"), invalidConfiguration("prototype-conflict"));
    const prototypeConflict = runRecord(project);
    assert.equal(prototypeConflict.status, 2, output(prototypeConflict));
    assert.match(
      output(prototypeConflict),
      /VALUE_ADAPTER_PROTOTYPE_CONFLICT VALUE_ADAPTER_REGISTRY_FAILED VALUE_ADAPTER_PROTOTYPE_DUPLICATE/,
    );
    await assert.rejects(readFile(path.join(project, "target-ran")), { code: "ENOENT" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("exact prototype matching verified", () => {
  class Exact {}
  let tokenGetterCalls = 0;
  const getterToken = {};
  Object.defineProperty(getterToken, "prototype", { get() { tokenGetterCalls += 1; throw new Error("trap"); } });
  assertConfigurationCode(() => registry(adapter(getterToken)), "VALUE_ADAPTER_TOKEN_INVALID");
  assert.equal(tokenGetterCalls, 0);

  let proxyTraps = 0;
  const proxyToken = new Proxy(Exact, { getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("trap"); } });
  assertConfigurationCode(() => registry(adapter(proxyToken)), "VALUE_ADAPTER_TOKEN_INVALID");
  assert.equal(proxyTraps, 0);

  const exact = registry(adapter(Exact));
  const value = new Exact();
  Object.defineProperty(value, "constructor", { get() { throw new Error("constructor trap"); } });
  Object.defineProperty(Exact, Symbol.hasInstance, { value() { throw new Error("hasInstance trap"); } });
  assert.equal(exact.findForValue(value)?.id, "example.value");
  assert.equal(exact.findForValue(new Proxy(value, {})), undefined);
});

test("adapter identity isolation verified", () => {
  class Exact {}
  class Subclass extends Exact {}
  class MockDuplicate {}
  const exact = registry(adapter(Exact));
  assert.equal(exact.findForValue(new Exact())?.id, "example.value");
  assert.equal(exact.findForValue(new Subclass()), undefined);
  assert.equal(exact.findForValue(new MockDuplicate()), undefined);

  const token = { prototype: Exact.prototype };
  const snapshotted = registry(adapter(token));
  class Alternate {}
  token.prototype = Alternate.prototype;
  assert.equal(snapshotted.findForValue(new Exact())?.id, "example.value");
  assert.equal(snapshotted.findForValue(new Alternate()), undefined);
});

test("adapter payload boundary verified", () => {
  class Outer {}
  class Inner {}
  const adapters = registry(
    adapter(Outer, "example.outer", { serialize: () => ({ nested: new Inner() }) }),
    adapter(Inner, "example.inner"),
  );
  assert.throws(() => encodeCanonicalValue(new Outer(), {}, adapters), UnsupportedValueError);

  const safe = registry(adapter(Outer, "example.outer", {
    serialize: () => ({ nested: [{ canonicalLookingData: true }] }),
  }));
  const encoded = encodeCanonicalValue({ argument: new Outer(), completionLike: [new Outer()] }, {}, safe);
  assert.equal(encoded.kind, "record");
  assert.equal(JSON.stringify(encoded).match(/\"kind\":\"adapted\"/g)?.length, 2);
});

test("adapted traversal budgets verified", () => {
  class Alias {}
  const aliasRegistry = registry(adapter(Alias, "example.alias", { serialize: (value) => ({ value }) }));
  assert.throws(() => encodeCanonicalValue(new Alias(), {}, aliasRegistry), UnsupportedValueError);

  class Deep {}
  const deepRegistry = registry(adapter(Deep, "example.deep", {
    serialize: () => ({ one: { two: { three: 3 } } }),
  }));
  assert.throws(
    () => encodeCanonicalValue(new Deep(), { maxDepth: 3 }, deepRegistry),
    CanonicalLimitError,
  );
  assert.doesNotThrow(() => encodeCanonicalValue(new Deep(), { maxDepth: 5 }, deepRegistry));

  class Secret {}
  const secretRegistry = registry(adapter(Secret, "example.secret", {
    serialize: () => ({ apiKey: "not-printed-secret-material" }),
  }));
  const result = classifyObservation({
    locator: { module: "src/value.ts", exportName: "value" },
    entryArguments: [new Secret()],
    exitArguments: [new Secret()],
    completion: { kind: "return", value: 1 },
  }, { valueAdapters: secretRegistry });
  assert.equal(result.safe, false);
  assert.equal(result.code, "SENSITIVE_VALUE");
  assert.doesNotMatch(JSON.stringify(result), /not-printed-secret-material|apiKey/);
});

async function invalidProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-invalid-adapter-"));
  await cp(fixtureRoot, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(repositoryRoot, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "src", "calculation.ts"), `
/** @replaylock capture */
export function calculate(left: number, right: number): number {
  return left + right;
}
`);
  await writeFile(path.join(project, "test", "calculation.test.ts"), `
import { writeFileSync } from "node:fs";
import { calculate } from "../src/calculation.js";
test("target stays behind setup", () => {
  expect(calculate(2, 3)).toBe(5);
  writeFileSync("target-ran", "yes");
});
`);
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock, defineValueAdapter } from "replaylock";
class Value {}
export default defineReplayLock({ valueAdapters: [defineValueAdapter({
  type: Value, id: "not-namespaced", version: 1,
  serialize() { return {}; }, deserialize() { return new Value(); },
})] });
`);
  return project;
}

function invalidConfiguration(kind) {
  const secondType = kind === "id-conflict" ? "OtherValue" : "Value";
  const secondId = kind === "id-conflict" ? "example.same" : "example.other";
  return `
import { defineReplayLock, defineValueAdapter } from "replaylock";
class Value {}
class OtherValue {}
const first = defineValueAdapter({
  type: Value, id: "example.same", version: 1,
  serialize() { return {}; }, deserialize() { return new Value(); },
});
const second = defineValueAdapter({
  type: ${secondType}, id: "${secondId}", version: 1,
  serialize() { return {}; }, deserialize() { return new ${secondType}(); },
});
export default defineReplayLock({ valueAdapters: [first, second] });
`;
}

async function realmProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-adapter-realms-"));
  await cp(fixtureRoot, project, { recursive: true });
  await mkdir(path.join(project, "node_modules"));
  await symlink(repositoryRoot, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(project, "vitest.config.ts"), `
import { replaylock } from "replaylock/vite";
export default { plugins: [replaylock()], test: {
  globals: true, include: ["test/**/*.test.ts"], pool: "forks", maxWorkers: 2, fileParallelism: true,
} };
`);
  await writeFile(path.join(project, "src", "money.ts"), `
export class Money { constructor(readonly cents: number) {} }
`);
  await writeFile(path.join(project, "src", "calculation.ts"), `
import { Money } from "./money.js";
/**
 * @replaylock capture
 * @replaylock assume-pure reviewed domain-value access
 */
export function cents(value: Money): number { return value.cents; }
`);
  await writeFile(path.join(project, "replaylock.config.ts"), `
import { defineReplayLock, defineValueAdapter } from "replaylock";
import { Money } from "./src/money.js";
export default defineReplayLock({ valueAdapters: [defineValueAdapter({
  type: Money, id: "example.money", version: 1,
  serialize(value: Money) { return { cents: value.cents }; },
  deserialize(payload: unknown) { return new Money((payload as { cents: number }).cents); },
})] });
`);
  for (const name of ["a", "b"]) {
    await writeFile(path.join(project, "test", `${name}.test.ts`), `
import { writeFileSync } from "node:fs";
import { valueAdapterRegistry } from "virtual:replaylock/value-adapters";
import { cents } from "../src/calculation.js";
import { Money } from "../src/money.js";
test("worker ${name}", () => {
  const value = new Money(125);
  expect(cents(value)).toBe(125);
  writeFileSync("realm-${name}.json", JSON.stringify({
    frozen: Object.isFrozen(valueAdapterRegistry),
    adaptersFrozen: Object.isFrozen(valueAdapterRegistry.adapters),
    matched: valueAdapterRegistry.findForValue(value)?.id,
  }));
});
`);
  }
  await rm(path.join(project, "test", "calculation.test.ts"));
  return project;
}

function runRecord(project) {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  return spawnSync(process.execPath, [cliPath, "record", "--", process.execPath, vitestPath, "run", "--config", "vitest.config.ts"], {
    cwd: project, encoding: "utf8", env: environment, timeout: 30_000,
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
