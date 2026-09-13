import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { types } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { defineReplayLock, defineValueAdapter } from "../../dist/index.js";
import {
  configureDevRuntime, devEffect, flushDevRuntime, observeDevCall, replayDevTrace,
  runtimeProfile, withDevContext,
} from "../../dist/dev-runtime.js";
import {
  assertDevSafe, decodeDevValue, DEV_VALUE_LIMITS, encodeDevValue,
  validateDevAdapters, validateDevValue,
} from "../../dist/dev-values.js";

const metadata = (name = "target", generation = "one") => ({
  locator: { module: "src/example.ts", kind: "export", namePath: [name] },
  sourceGraphDigest: "a".repeat(64), generation, environment: "node",
});
const codec = { isProxy: types.isProxy };
function capture(options = {}) {
  const observations = [], blocks = [];
  configureDevRuntime({ ...codec, onObservation: value => observations.push(value), onBlock: value => blocks.push(value), ...options });
  return { observations, blocks };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const offline = () => { assert.fail("a native read was executed during replay"); };
const calls = observation => observation.trace.filter(event => event.kind === "call");
afterEach(() => configureDevRuntime(undefined));

test("canonical values retain types, stable record order, errors and prototype-safe keys", () => {
  const cause = new TypeError("bad input");
  cause.code = "EINVAL";
  const error = new Error("read failed", { cause });
  const values = [undefined, null, true, 1.25, "plain", new Date("2024-01-02T03:04:05.000Z"), new Uint8Array([0, 255, 8]), new Uint8Array([1, 2]).buffer, Buffer.from([3, 4]), error];
  for (const value of values) {
    const encoded = encodeDevValue(value, codec);
    const decoded = decodeDevValue(JSON.parse(JSON.stringify(encoded)), codec);
    assert.deepEqual(encodeDevValue(decoded, codec), encoded);
    assert.equal(Object.getPrototypeOf(decoded ?? {}), Object.getPrototypeOf(value ?? {}));
  }
  assert.deepEqual(encodeDevValue({ z: 1, a: 2 }), encodeDevValue({ a: 2, z: 1 }));
  const record = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.deepEqual(decodeDevValue(encodeDevValue(record)), record);
  assert.equal({}.polluted, undefined);
  assert.equal(JSON.stringify(encodeDevValue(error)).includes("stack"), false);
  assertDevSafe({ label: "safe" });
});

test("canonical boundaries reject aliases, holes, exotic values, accessors and proxies without reading them", () => {
  let getters = 0, traps = 0;
  const accessor = { get value() { getters++; return 1; } };
  const thenable = { get then() { getters++; return () => {}; } };
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; }, getPrototypeOf() { traps++; return Object.prototype; } });
  const alias = {};
  const cycle = {}; cycle.self = cycle;
  for (const value of [NaN, Infinity, -0, 1n, Symbol(), () => {}, new Map(), Object.create(null), new (class {})(), [alias, alias], cycle, new Array(1), { [Symbol()]: 1 }, accessor, thenable, proxy]) {
    assert.throws(() => encodeDevValue(value, codec), { code: "UNSUPPORTED_VALUE" });
  }
  assert.equal(getters, 0); assert.equal(traps, 0);
  assert.throws(() => encodeDevValue("a".repeat(DEV_VALUE_LIMITS.bytes + 1)), { code: "OVERSIZED_OBSERVATION" });
  assert.throws(() => encodeDevValue(new Array(DEV_VALUE_LIMITS.nodes + 1).fill(1)), { code: "OVERSIZED_OBSERVATION" });
  let deep = 0; for (let i = 0; i < 22; i++) deep = [deep];
  assert.throws(() => encodeDevValue(deep), { code: "OVERSIZED_OBSERVATION" });
});

test("privacy covers normalized keys, file bodies, HTTP credentials, adapter payloads and encoded bytes", () => {
  const values = [
    { "API Key": "seeded" }, { nested: { refresh_token: "seeded" } }, "Bearer seeded-value",
    "https://user:seeded@example.test", "https://example.test/?api_key=seeded",
    '{"password":"seeded"}', "ghp_seeded", "-----BEGIN PRIVATE KEY-----",
    Buffer.from('{"client_secret":"seeded"}'), new TextEncoder().encode("sk-seeded"),
    Buffer.from('password=seeded', "utf16le"),
  ];
  for (const value of values) assert.throws(() => encodeDevValue(value, codec), { code: "SENSITIVE_VALUE" });
  const encoded = { kind: "bytes", type: "Uint8Array", value: Buffer.from("Bearer seeded").toString("base64") };
  assert.throws(() => validateDevValue(encoded), { code: "SENSITIVE_VALUE" });
  const { observations, blocks } = capture();
  const original = { password: "seeded" };
  assert.equal(observeDevCall(metadata(), [original], () => original), original);
  assert.deepEqual(observations, []);
  assert.deepEqual(blocks, [{ code: "SENSITIVE_VALUE", locator: metadata().locator, metadata: metadata() }]);
  assert.equal(JSON.stringify(blocks).includes("seeded"), false);
});

test("adapters use exact prototypes, never deserialize during capture, and round-trip in replay", () => {
  class Amount { constructor(value) { this.value = value; } }
  class Derived extends Amount {}
  let serialized = 0, deserialized = 0;
  const adapter = { id: "amount", version: 1, type: Amount, serialize(value) { serialized++; return value.value; }, deserialize(value) { deserialized++; return new Amount(value); } };
  validateDevAdapters([adapter]);
  const encoded = encodeDevValue(new Amount(3), { adapters: [adapter] });
  assert.equal(serialized, 1); assert.equal(deserialized, 0);
  assert.throws(() => encodeDevValue(new Derived(3), { adapters: [adapter] }), { code: "UNSUPPORTED_VALUE" });
  assert.throws(() => validateDevAdapters([adapter, { ...adapter, id: "other" }]), { code: "VALUE_ADAPTER_DEFINITION_INVALID" });
  assert.throws(() => validateDevAdapters([{ ...adapter, type: Date }]), { code: "VALUE_ADAPTER_DEFINITION_INVALID" });
  assert.throws(() => decodeDevValue(encoded), { code: "VALUE_ADAPTER_MISSING" });
  const result = decodeDevValue(encoded, { adapters: [adapter] });
  assert.equal(Object.getPrototypeOf(result), Amount.prototype); assert.equal(result.value, 3);
  assert.throws(() => decodeDevValue(encoded, { adapters: [{ ...adapter, deserialize: () => new Derived(3) }] }), { code: "VALUE_ADAPTER_PROTOTYPE_MISMATCH" });
  assert.throws(() => decodeDevValue(encoded, { adapters: [{ ...adapter, deserialize: () => new Amount(4) }] }), { code: "VALUE_ADAPTER_ROUND_TRIP_MISMATCH" });
  assert.throws(() => encodeDevValue(new Amount(1), { adapters: [{ ...adapter, serialize: () => ({ password: "seeded" }) }] }), { code: "SENSITIVE_VALUE" });
  assert.throws(() => encodeDevValue(new Amount(1), { adapters: [{ ...adapter, serialize: () => new Amount(1) }] }), { code: "UNSUPPORTED_VALUE" });
  const recorded = capture({ adapters: [adapter] });
  const before = deserialized;
  const input = new Amount(7);
  observeDevCall(metadata(), [input], () => input.value);
  assert.equal(deserialized, before); assert.equal(recorded.observations.length, 1);
});

test("defineReplayLock frozen adapter registries configure capture and round-trip values", () => {
  class Amount { constructor(value) { this.value = value; } }
  const adapter = defineValueAdapter({
    id: "app/amount", version: 1, type: Amount,
    serialize: value => value.value, deserialize: value => new Amount(value),
  });
  const configuration = defineReplayLock({ valueAdapters: [adapter] });
  assert.equal(Object.isFrozen(configuration.valueAdapters), true);
  assert.equal(Object.getOwnPropertyDescriptor(configuration.valueAdapters, "length").writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(configuration.valueAdapters, "0").writable, false);
  assert.doesNotThrow(() => validateDevAdapters(configuration.valueAdapters));
  assert.doesNotThrow(() => validateDevAdapters(defineReplayLock({}).valueAdapters));
  const options = { adapters: configuration.valueAdapters };
  const { observations, blocks } = capture(options);
  const input = new Amount(7);
  assert.equal(observeDevCall(metadata(), [input], () => input.value), 7);
  assert.equal(observations.length, 1); assert.deepEqual(blocks, []);
  const decoded = decodeDevValue(observations[0].arguments, options);
  assert.equal(Object.getPrototypeOf(decoded[0]), Amount.prototype);
  assert.equal(decoded[0].value, 7);
  assert.deepEqual(encodeDevValue(decoded, options), observations[0].arguments);
  // Registry immutability does not relax the captured value model.
  assert.throws(() => encodeDevValue(Object.freeze([1])), { code: "UNSUPPORTED_VALUE" });
});

test("readonly adapter registries remain dense data arrays without getters or extra keys", () => {
  class Amount {}
  const adapter = { id: "amount", version: 1, type: Amount, serialize: () => 1, deserialize: () => new Amount() };
  assert.doesNotThrow(() => validateDevAdapters(Object.seal([adapter])));
  let reads = 0;
  const accessor = [adapter];
  Object.defineProperty(accessor, "0", { get() { reads++; return adapter; } });
  Object.freeze(accessor);
  const extra = Object.assign([adapter], { extra: true });
  const symbol = [adapter]; symbol[Symbol("extra")] = true;
  for (const invalid of [accessor, Object.freeze(new Array(1)), Object.freeze(extra), Object.freeze(symbol)]) {
    assert.throws(() => validateDevAdapters(invalid), { code: "UNSUPPORTED_VALUE" });
  }
  assert.equal(reads, 0);
});

test("artifact validation is strict, bounded and detached without invoking getters", () => {
  const canonical = encodeDevValue({ a: [1, "two"] });
  const validated = validateDevValue(canonical);
  assert.deepEqual(validated, canonical); assert.notEqual(validated, canonical);
  let reads = 0;
  for (const value of [
    { kind: "number", value: 1, extra: true }, { kind: "date", value: "2024-01-01" },
    { kind: "bytes", type: "Uint8Array", value: "Zh==" },
    { kind: "record", entries: [{ key: "z", value: { kind: "null" } }, { key: "a", value: { kind: "null" } }] },
    { kind: "string", get value() { reads++; return "no"; } },
    { kind: "adapted", adapterId: "x", version: 0, payload: { kind: "null" } },
  ]) assert.throws(() => validateDevValue(value), { code: "UNSUPPORTED_VALUE" });
  assert.equal(reads, 0);
});

test("native byte snapshots reject overrides, shared stores and spoofed brands without invoking accessors", () => {
  let reads = 0;
  const bytes = new Uint8Array([1]);
  Object.defineProperty(bytes, "buffer", { get() { reads++; return new ArrayBuffer(1); } });
  assert.throws(() => encodeDevValue(bytes), { code: "UNSUPPORTED_VALUE" });
  assert.equal(reads, 0);
  for (const prototype of [Date.prototype, ArrayBuffer.prototype, Uint8Array.prototype]) {
    assert.throws(() => encodeDevValue(Object.create(prototype)), { code: "UNSUPPORTED_VALUE" });
  }
  assert.throws(() => encodeDevValue(new Uint8Array(new SharedArrayBuffer(4))), { code: "UNSUPPORTED_VALUE" });
  assert.throws(() => encodeDevValue(Object.freeze([])), { code: "UNSUPPORTED_VALUE" });
  assert.throws(() => encodeDevValue(new ArrayBuffer(4, { maxByteLength: 8 })), { code: "UNSUPPORTED_VALUE" });
  const larger = new Uint8Array(32 * 1024);
  assert.deepEqual(decodeDevValue(encodeDevValue(larger)), larger);
});

test("byte budgets stop before scanning an oversized value's remaining properties", () => {
  let reads = 0;
  const value = { a: "a".repeat(150000), b: "b".repeat(150000), get c() { reads++; throw Error("unreachable"); } };
  assert.throws(() => encodeDevValue(value), { code: "OVERSIZED_OBSERVATION" });
  assert.equal(reads, 0);
  const canonical = { kind: "array", items: [{ kind: "string", value: value.a }, { kind: "string", value: value.b }, { get kind() { reads++; throw Error("unreachable"); } }] };
  assert.throws(() => validateDevValue(canonical), { code: "OVERSIZED_OBSERVATION" });
  assert.equal(reads, 0);
});

test("capture never consults a promise's custom constructor or species", async () => {
  const { observations, blocks } = capture();
  let reads = 0;
  const pending = deferred();
  Object.defineProperty(pending.promise, "constructor", { configurable: true, get() { reads++; return Promise; } });
  const result = observeDevCall(metadata(), [], () => pending.promise, true);
  assert.equal(result, pending.promise); assert.equal(reads, 0);
  assert.equal(observations.length, 0); assert.equal(blocks[0].code, "UNSUPPORTED_VALUE");
  delete pending.promise.constructor;
  pending.resolve(1); assert.equal(await result, 1);
});

test("native promises carrying async-hooks symbols capture normally", async () => {
  const { observations, blocks } = capture();
  const storage = new AsyncLocalStorage();
  try {
    await storage.run({ request: 1 }, async () => {
      const promise = Promise.resolve("text");
      assert.ok(Reflect.ownKeys(promise).some(key => typeof key === "symbol"));
      const result = observeDevCall(metadata(), [], frame => devEffect(frame, "fs.readFile", ["file"], () => promise), true);
      assert.equal(result, promise); assert.equal(await result, "text");
    });
    assert.equal(observations.length, 1); assert.deepEqual(blocks, []);
  } finally { storage.disable(); }
});

test("observation sinks cannot mutate shared ancestor projections", () => {
  let outer;
  capture({ onObservation(value) {
    if (value.locator.namePath[0] === "inner") value.trace[1].value.value = 9000;
    else outer = value;
  } });
  observeDevCall(metadata("outer"), [], frame => withDevContext(frame, () => observeDevCall(metadata("inner"), [], child => devEffect(child, "Math.random", [], () => 0.5))));
  assert.equal(outer.trace[1].value.value, 0.5);
});

test("trace preflight rejects accessor events without invoking them or application code", async () => {
  let reads = 0;
  const trace = [{ kind: "call", id: 0, get operation() { reads++; return "Date.now"; }, arguments: encodeDevValue([]) }, { kind: "return", id: 0, value: encodeDevValue(1) }];
  await assert.rejects(replayDevTrace(trace, offline), { code: "TRACE_MISMATCH" });
  assert.equal(reads, 0);
  const proxy = new Proxy([], { getPrototypeOf() { reads++; return Array.prototype; } });
  await assert.rejects(replayDevTrace(proxy, offline, codec), { code: "TRACE_MISMATCH" });
  assert.equal(reads, 0);
});

test("changed async dependencies produce a bounded mismatch instead of waiting forever", { timeout: 7000 }, async () => {
  const trace = [
    { kind: "call", id: 0, operation: "fs.readFile", arguments: encodeDevValue(["a"]) },
    { kind: "call", id: 1, operation: "fs.readFile", arguments: encodeDevValue(["b"]) },
    { kind: "return", id: 1, value: encodeDevValue("B") },
    { kind: "return", id: 0, value: encodeDevValue("A") },
  ];
  await assert.rejects(replayDevTrace(trace, async frame => {
    // Originally both reads began before either settled. This version deadlocks.
    await devEffect(frame, "fs.readFile", ["a"], offline);
    return devEffect(frame, "fs.readFile", ["b"], offline);
  }), { code: "TRACE_MISMATCH" });
});

test("sync effects execute once, retain throw identity, and replay exact offline inputs", async () => {
  const { observations, blocks } = capture();
  let reads = 0;
  const problem = new TypeError("read failed");
  const target = frame => {
    const random = devEffect(frame, "Math.random", [], () => { reads++; return 0.25; });
    let failure;
    try { devEffect(frame, "fs.readFileSync", ["missing.txt"], () => { reads++; throw problem; }); }
    catch (error) { failure = error.message; if (reads) assert.equal(error, problem); }
    return [random, failure];
  };
  assert.deepEqual(observeDevCall(metadata(), [], target), [0.25, "read failed"]);
  assert.equal(reads, 2); assert.equal(observations.length, 1); assert.deepEqual(blocks, []);
  const trace = observations[0].trace;
  assert.deepEqual(trace.map(event => [event.kind, event.id]), [["call", 0], ["return", 0], ["call", 1], ["throw", 1]]);
  const result = await replayDevTrace(trace, frame => {
    const random = devEffect(frame, "Math.random", [], offline);
    let failure;
    try { devEffect(frame, "fs.readFileSync", ["missing.txt"], offline); } catch (error) { assert.equal(error instanceof TypeError, true); failure = error.message; }
    return [random, failure];
  });
  assert.deepEqual(result, [0.25, "read failed"]);
});

test("mutation and observer failures cannot change application completion", async () => {
  const recorded = capture();
  const input = { value: 1 };
  assert.equal(observeDevCall(metadata(), [input], () => { input.value++; return 9; }), 9);
  assert.deepEqual(recorded.observations, []); assert.equal(recorded.blocks[0].code, "MUTATED_INPUT");
  configureDevRuntime({ onObservation() { throw new Error("storage failed"); }, onBlock() { throw new Error("report failed"); } });
  const original = new Error("application error");
  assert.throws(() => observeDevCall(metadata(), [], () => { throw original; }), error => error === original);
  const pending = deferred();
  assert.equal(observeDevCall(metadata(), [], () => pending.promise, true), pending.promise);
  pending.reject(original);
  await assert.rejects(pending.promise, error => error === original);
  assert.equal(observeDevCall(metadata(), [], () => 42), 42);
});

test("unconfigured capture preserves arbitrary promises and thenables without inspection", () => {
  configureDevRuntime(undefined);
  let reads = 0;
  const result = { get then() { reads++; throw new Error("unexpected"); } };
  assert.equal(observeDevCall(metadata(), [], () => result), result);
  assert.equal(devEffect(undefined, "anything", [], () => result), result);
  assert.equal(reads, 0);
});

test("nested and recursive capture projects each effect once to all active ancestors", async () => {
  const { observations, blocks } = capture();
  let reads = 0;
  const recursive = (n, native = () => { reads++; return 0.5; }) => observeDevCall(metadata(`level${n}`), [n], frame => {
    const own = devEffect(frame, "Math.random", [], native);
    return n ? own + withDevContext(frame, () => recursive(n - 1, native)) : own;
  });
  assert.equal(recursive(2), 1.5); assert.equal(reads, 3); assert.deepEqual(blocks, []);
  assert.deepEqual(observations.map(item => calls(item).length), [1, 2, 3]);
  assert.deepEqual(observations.map(item => calls(item).map(e => e.id)), [[0], [0, 1], [0, 1, 2]]);
  assert.equal(await replayDevTrace(observations[2].trace, () => recursive(2, offline)), 1.5);
  assert.equal(observations.length, 3);
});

test("overlapping asynchronous roots retain lexical context after awaits", async () => {
  const { observations, blocks } = capture();
  const a = deferred(), b = deferred();
  const run = (name, gate, native) => observeDevCall(metadata(name), [name], async frame => {
    const text = await devEffect(frame, "fs.readFile", [name], () => gate.promise);
    const stamp = withDevContext(frame, () => observeDevCall(metadata(`${name}Child`), [], child => devEffect(child, "Date.now", [], native)));
    return [text, stamp];
  }, true);
  const first = run("a", a, () => 10), second = run("b", b, () => 20);
  b.resolve("second"); await second; a.resolve("first"); await first;
  assert.deepEqual(blocks, []);
  const roots = observations.filter(item => ["a", "b"].includes(item.locator.namePath[0]));
  assert.deepEqual(roots.map(item => decodeDevValue(item.completion.value)), [["second", 20], ["first", 10]]);
  for (const root of roots) {
    assert.deepEqual(calls(root).map(e => e.operation), ["fs.readFile", "Date.now"]);
    const name = root.locator.namePath[0];
    const result = await replayDevTrace(root.trace, () => run(name, { get promise() { assert.fail("native closure ran"); } }, offline));
    assert.deepEqual(result, decodeDevValue(root.completion.value));
  }
});

test("asynchronous trace records and replays reverse settlement order with original promises", async () => {
  const { observations } = capture();
  const a = deferred(), b = deferred();
  const target = frame => {
    const first = devEffect(frame, "fs.readFile", ["a"], () => a.promise);
    const second = devEffect(frame, "fs.readFile", ["b"], () => b.promise);
    assert.equal(first, a.promise); assert.equal(second, b.promise);
    return Promise.all([first, second]);
  };
  const task = observeDevCall(metadata(), [], target, true);
  b.resolve("B"); await b.promise; a.resolve("A"); await task;
  assert.deepEqual(observations[0].trace.map(e => [e.kind, e.id]), [["call", 0], ["call", 1], ["return", 1], ["return", 0]]);
  const order = [];
  const result = await replayDevTrace(observations[0].trace, frame => {
    const first = devEffect(frame, "fs.readFile", ["a"], offline).then(value => { order.push("a"); return value; });
    const second = devEffect(frame, "fs.readFile", ["b"], offline).then(value => { order.push("b"); return value; });
    return Promise.all([first, second]);
  });
  assert.deepEqual(result, ["A", "B"]); assert.deepEqual(order, ["b", "a"]);
});

test("trace mismatches stay latched when application catches them", async () => {
  const { observations } = capture();
  observeDevCall(metadata(), [], frame => devEffect(frame, "Date.now", [], () => 123));
  const trace = observations[0].trace;
  for (const invoke of [
    () => 123,
    frame => { try { devEffect(frame, "Math.random", [], offline); } catch {} return 123; },
    frame => { devEffect(frame, "Date.now", [], offline); try { devEffect(frame, "Date.now", [], offline); } catch {} return 123; },
    frame => { try { devEffect(frame, "Date.now", [1], offline); } catch {} return 123; },
  ]) await assert.rejects(replayDevTrace(trace, invoke), { code: "TRACE_MISMATCH" });
  await assert.rejects(replayDevTrace(trace.slice(0, 1), offline), { code: "TRACE_MISMATCH" });
});

test("throw completions replay the recorded value and asynchronous effect rejection", async () => {
  const { observations } = capture();
  const target = frame => devEffect(frame, "fs.readFile", ["missing"], () => Promise.reject(new Error("unavailable")));
  await assert.rejects(observeDevCall(metadata(), [], target, true), /unavailable/);
  assert.equal(observations[0].completion.kind, "throw");
  await assert.rejects(replayDevTrace(observations[0].trace, frame => devEffect(frame, "fs.readFile", ["missing"], offline)), /unavailable/);
});

test("real file, environment, time, date and random reads replay after the inputs disappear", async () => {
  const directory = mkdtempSync(join(tmpdir(), "replaylock-trace-"));
  const path = join(directory, "input.txt");
  writeFileSync(path, "fixture");
  const { observations } = capture();
  let reads = 0;
  const target = async frame => {
    const invoke = fn => () => { reads++; return fn(); };
    const file = devEffect(frame, "fs.readFileSync", [path], invoke(() => readFileSync(path)));
    const text = await devEffect(frame, "fs.readFile", [path, "utf8"], invoke(() => readFile(path, "utf8")));
    return [file, text,
      devEffect(frame, "process.env", ["NODE_ENV"], invoke(() => process.env.NODE_ENV)),
      devEffect(frame, "import.meta.env", ["MODE"], invoke(() => "development")),
      devEffect(frame, "Date.now", [], invoke(() => Date.now())),
      devEffect(frame, "Date", [], invoke(() => Date())),
      devEffect(frame, "new Date", [], invoke(() => new Date())),
      devEffect(frame, "performance.now", [], invoke(() => performance.now())),
      devEffect(frame, "crypto.randomUUID", [], invoke(() => crypto.randomUUID())),
      devEffect(frame, "Math.random", [], invoke(() => Math.random())),
    ];
  };
  try {
    const result = await observeDevCall(metadata(), [], target, true);
    assert.equal(reads, 10);
    rmSync(directory, { recursive: true });
    const replayed = await replayDevTrace(observations[0].trace, target);
    assert.equal(reads, 10); assert.deepEqual(replayed, result);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("fetch retains the native response and consumes its body only through the application's reader", async () => {
  const { observations, blocks } = capture();
  const response = new Response('{"value":7}', { headers: { "content-type": "application/json" } });
  let fetches = 0, reads = 0;
  const result = await observeDevCall(metadata(), [], async frame => {
    const actual = await devEffect(frame, "fetch", ["https://example.test/data"], () => { fetches++; return Promise.resolve(response); });
    assert.equal(actual, response); assert.equal(actual.bodyUsed, false);
    const value = await devEffect(frame, "Response.json", [actual], () => { reads++; return actual.json(); });
    assert.equal(actual.bodyUsed, true);
    return [actual.status, actual.headers.get("content-type"), value];
  }, true);
  assert.deepEqual(blocks, []); assert.equal(fetches, 1); assert.equal(reads, 1);
  const replayed = await replayDevTrace(observations[0].trace, async frame => {
    const actual = await devEffect(frame, "fetch", ["https://example.test/data"], offline);
    assert.equal(actual instanceof Response, true); assert.equal(actual.bodyUsed, false);
    const value = await devEffect(frame, "Response.json", [actual], offline);
    assert.equal(actual.bodyUsed, true);
    return [actual.status, actual.headers.get("content-type"), value];
  });
  assert.deepEqual(replayed, result);
});

test("fetch text, bytes, failed second consumption and nested handle projection replay offline", async () => {
  const { observations, blocks } = capture();
  const target = () => observeDevCall(metadata("outer"), [], frame => withDevContext(frame, () => observeDevCall(metadata("inner"), [], async child => {
    const textResponse = await devEffect(child, "fetch", ["data:text/plain,hello"], () => fetch("data:text/plain,hello"));
    const text = await devEffect(child, "Response.text", [textResponse], () => textResponse.text());
    let failed = false;
    try { await devEffect(child, "Response.text", [textResponse], () => textResponse.text()); } catch (error) { failed = error instanceof TypeError; }
    const bytesResponse = await devEffect(child, "fetch", ["data:text/plain,bytes"], () => fetch("data:text/plain,bytes"));
    const bytes = await devEffect(child, "Response.arrayBuffer", [bytesResponse], () => bytesResponse.arrayBuffer());
    return [text, failed, new Uint8Array(bytes)];
  }, true)), true);
  const result = await target();
  assert.deepEqual(blocks, []); assert.equal(observations.length, 2);
  assert.deepEqual(observations[0].trace, observations[1].trace);
  assert.deepEqual(await replayDevTrace(observations[1].trace, target), result);
});

test("response handles are renumbered in ancestor traces and cannot be swapped in replay", async () => {
  const { observations, blocks } = capture();
  const target = () => observeDevCall(metadata("outer"), [], async frame => {
    devEffect(frame, "Date.now", [], () => 123);
    return withDevContext(frame, () => observeDevCall(metadata("inner"), [], async child => {
      const response = await devEffect(child, "fetch", ["data:text/plain,hello"], () => fetch("data:text/plain,hello"));
      return devEffect(child, "Response.text", [response], () => response.text());
    }, true));
  }, true);
  assert.equal(await target(), "hello"); assert.deepEqual(blocks, []);
  const inner = observations.find(o => o.locator.namePath[0] === "inner"), outer = observations.find(o => o.locator.namePath[0] === "outer");
  assert.equal(decodeDevValue(calls(inner)[1].arguments)[0].responseId, 0);
  assert.equal(decodeDevValue(calls(outer)[2].arguments)[0].responseId, 1);
  assert.equal(await replayDevTrace(outer.trace, target), "hello");
  await assert.rejects(replayDevTrace(inner.trace, async frame => {
    await devEffect(frame, "fetch", ["data:text/plain,hello"], offline);
    try { await devEffect(frame, "Response.text", [new Response("hello")], offline); } catch {}
  }), { code: "TRACE_MISMATCH" });
});

test("unsupported effects and proxy fetch options run once but produce valueless blocks", () => {
  let reads = 0, traps = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { traps++; return Object.prototype; } });
  for (const [operation, args] of [["fs.writeFileSync", ["file", "text"]], ["fs.readFileSync", ["file", { flag: "w+" }]], ["fetch", ["https://example.test", proxy]], ["fs.readFile", ["file", () => {}]]]) {
    const { observations, blocks } = capture();
    assert.equal(observeDevCall(metadata(), [], frame => devEffect(frame, operation, args, () => { reads++; return 42; })), 42);
    assert.deepEqual(observations, []); assert.equal(blocks.length, 1);
    assert.deepEqual(Object.keys(blocks[0]).sort(), ["code", "locator", "metadata"]);
    assert.deepEqual(blocks[0].metadata, metadata());
  }
  assert.equal(reads, 4); assert.equal(traps, 0);
});

test("aggregate trace and pending-invocation limits bound capture while ordinary calls continue", async () => {
  const recorded = capture();
  let reads = 0;
  const result = observeDevCall(metadata(), [], frame => {
    for (let i = 0; i < 50; i++) devEffect(frame, "fs.readFileSync", ["file"], () => { reads++; return "x".repeat(10000); });
    return 7;
  });
  assert.equal(result, 7); assert.equal(reads, 50); assert.deepEqual(recorded.observations, []);
  assert.equal(recorded.blocks[0].code, "OVERSIZED_OBSERVATION"); assert.equal(recorded.blocks.length, 1);
  const pending = capture();
  const gate = deferred();
  for (let i = 0; i < 1001; i++) observeDevCall(metadata(), [], () => gate.promise, true);
  assert.equal(pending.blocks.length, 1); assert.equal(pending.blocks[0].code, "PENDING_LIMIT");
  await flushDevRuntime(0);
  gate.resolve(1); await gate.promise;
  assert.deepEqual(pending.observations, []);
});

test("sensitive headers and bodies suppress the whole invocation while native fetch still runs", async () => {
  const { observations, blocks } = capture();
  let reads = 0;
  const response = new Response("Bearer seeded");
  const value = await observeDevCall(metadata(), [], async frame => {
    const actual = await devEffect(frame, "fetch", ["https://example.test"], () => { reads++; return Promise.resolve(response); });
    return devEffect(frame, "Response.text", [actual], () => { reads++; return actual.text(); });
  }, true);
  assert.equal(value, "Bearer seeded"); assert.equal(reads, 2); assert.deepEqual(observations, []);
  assert.equal(blocks[0].code, "SENSITIVE_VALUE"); assert.equal(JSON.stringify(blocks).includes("seeded"), false);
  const second = capture();
  await observeDevCall(metadata(), [], async frame => {
    await devEffect(frame, "fetch", ["https://example.test", { headers: [["Authorization", "safe-looking"]] }], () => { reads++; return Promise.resolve(new Response()); });
    return 1;
  }, true);
  assert.equal(second.observations.length, 0); assert.equal(second.blocks[0].code, "SENSITIVE_VALUE"); assert.equal(reads, 3);
});

test("unsealed effects and detached children are valueless incomplete observations", async () => {
  const { observations, blocks } = capture();
  const pending = deferred();
  assert.equal(observeDevCall(metadata("detachedEffect"), [], frame => { devEffect(frame, "fs.readFile", ["a"], () => pending.promise); return 1; }), 1);
  const child = deferred();
  observeDevCall(metadata("parent"), [], frame => { withDevContext(frame, () => observeDevCall(metadata("child"), [], () => child.promise, true)); return 2; });
  assert.deepEqual(observations, []);
  assert.deepEqual(blocks.map(value => value.code), ["INCOMPLETE_OBSERVATION", "INCOMPLETE_OBSERVATION"]);
  await flushDevRuntime(0);
  child.resolve(3); pending.resolve("later"); await Promise.all([child.promise, pending.promise]);
  assert.deepEqual(observations, []); assert.equal(blocks.length, 3);
});

test("drain stops new roots, permits children of existing roots, then deactivates", async () => {
  const { observations, blocks } = capture();
  const pending = deferred();
  const result = observeDevCall(metadata("root"), [], async frame => {
    await pending.promise;
    return withDevContext(frame, () => observeDevCall(metadata("child"), [], child => devEffect(child, "Math.random", [], () => 0.75)));
  }, true);
  const drain = flushDevRuntime(1000);
  assert.equal(observeDevCall(metadata("newRoot"), [], () => 10), 10);
  pending.resolve(); await result; assert.equal(await drain, undefined);
  assert.deepEqual(observations.map(o => o.locator.namePath[0]), ["child", "root"]); assert.deepEqual(blocks, []);
  configureDevRuntime(undefined);
  observeDevCall(metadata("disabled"), [], () => 20);
  assert.equal(observations.length, 2);
});

test("drain timeout and mixed HMR generations block values without affecting callers", async () => {
  const { observations, blocks } = capture();
  const pending = deferred();
  const original = observeDevCall(metadata(), [], () => pending.promise, true);
  await flushDevRuntime(0);
  pending.resolve(12); assert.equal(await original, 12);
  assert.deepEqual(observations, []); assert.equal(blocks[0].code, "INCOMPLETE_OBSERVATION");
  const next = capture();
  assert.equal(observeDevCall(metadata("parent", "one"), [], frame => withDevContext(frame, () => observeDevCall(metadata("child", "two"), [], () => 3))), 3);
  assert.deepEqual(next.observations, []); assert.equal(next.blocks[0].code, "GENERATION_MISMATCH");
});

test("duplicate runtime module identities share configuration and synchronous context", async () => {
  const duplicate = await import(`../../dist/dev-runtime.js?duplicate=acceptance`);
  const { observations } = capture();
  const result = duplicate.observeDevCall(metadata("outer"), [], frame => withDevContext(frame, () => observeDevCall(metadata("inner"), [], child => duplicate.devEffect(child, "Date.now", [], () => 99))));
  assert.equal(result, 99); assert.equal(observations.length, 2); assert.deepEqual(observations[0].trace, observations[1].trace);
  assert.equal(await duplicate.replayDevTrace(observations[1].trace, frame => devEffect(frame, "Date.now", [], offline)), 99);
  const profile = runtimeProfile("node");
  assert.equal(profile.environment, "node"); assert.equal(profile.runtime.includes(process.versions.node), true);
  assert.equal(typeof profile.timezone, "string"); assert.equal(typeof profile.locale, "string");
});

test("portable modules load and replay in a realm without Node globals", () => {
  for (const file of ["dev-values", "dev-runtime"]) assert.doesNotMatch(readFileSync(new URL(`../../dist/${file}.js`, import.meta.url), "utf8"), /from\s*["']node:|import\s*\(["']node:/);
  const script = `
    import { readFileSync } from 'node:fs';
    import vm from 'node:vm';
    const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, queueMicrotask });
    const values = new vm.SourceTextModule(readFileSync('dist/dev-values.js', 'utf8'), { context });
    const runtime = new vm.SourceTextModule(readFileSync('dist/dev-runtime.js', 'utf8'), { context });
    await values.link(() => { throw Error('unexpected import'); });
    await runtime.link(() => values);
    await runtime.evaluate();
    context.api = runtime.namespace; context.codec = values.namespace;
    const result = await vm.runInContext(
      '(async () => { let observation; api.configureDevRuntime({onObservation(v) {observation = v}, onBlock(v) {throw Error(v.code)}});' +
      'const metadata = {locator:{module:"x.ts",kind:"export",namePath:["x"]},sourceGraphDigest:"abc",generation:"one",environment:"browser"};' +
      'const run = frame => api.devEffect(frame,"Math.random",[],()=>0.2);' +
      'api.observeDevCall(metadata,[],run);' +
      'return [await api.replayDevTrace(observation.trace,run),codec.decodeDevValue(codec.encodeDevValue(new Uint8Array([1,2])))[1],typeof process,typeof Buffer];})()', context);
    if (JSON.stringify(result) !== '[0.2,2,"undefined","undefined"]') throw Error(JSON.stringify(result));
    console.log('portable realm verified');
  `;
  const run = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", script], { cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 10000 });
  assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /portable realm verified/);
});
