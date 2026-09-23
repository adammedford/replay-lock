import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { transformDevSource, analyzeDevProject } from "../../dist/dev-transform.js";
import { configureDevRuntime, replayDevTrace } from "../../dist/dev-runtime.js";
import { decodeDevValue } from "../../dist/dev-values.js";

const runtimeImport = new URL("../../dist/dev-runtime.js", import.meta.url).href;
const defaults = {
  capture: { mode: "automatic", include: ["**/*"], exclude: [] },
  effects: { randomness: true, time: true, fetch: true, filesystem: true, environment: ["REPLAYLOCK_TEST_COLOR", "MODE"] },
};
function project(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "replaylock-dev-transform-"));
  t.after(() => { configureDevRuntime(undefined); rmSync(root, { recursive: true, force: true }); });
  for (const [name, contents] of Object.entries({ "package.json": '{"type":"module"}', ...files })) put(root, name, contents);
  return root;
}
function put(root, name, contents) { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), contents); }
function transform(root, name = "source.ts", extra = {}) {
  return transformDevSource({ root, id: path.join(root, name), code: readFileSync(path.join(root, name), "utf8"), environment: "node", generation: "test-generation", options: defaults, runtimeImport, ...extra });
}
let imports = 0;
async function load(root, result, name = "source") {
  const file = path.join(root, ".output", `${name}-${imports++}.mjs`);
  const compiled = ts.transpileModule(result.code, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  assert.deepEqual(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, compiled.outputText);
  return import(pathToFileURL(file).href);
}
function capture() {
  const observations = [], blocks = [];
  configureDevRuntime({ onObservation: (value) => observations.push(value), onBlock: (value) => blocks.push(value) });
  return { observations, blocks };
}
const names = (result) => result.targets.map((target) => target.locator.namePath.join("."));
const ops = (observation) => observation.trace.filter((event) => event.kind === "call").map((event) => event.operation);

test("discovers exports, private module functions, and stateless lexical children without executing owners", async (t) => {
  const root = project(t, { "source.ts": `
const SCALE = 3;
function privateValue(value: number) { return value * SCALE; }
export function owner(outer: number) {
  throw new Error("owner must never execute in replay");
  function nested(n: number): number { return n <= 0 ? SCALE : nested(n - 1) + 1; }
  function captured(n: number) { return n + outer; }
}
export const entry = (value: number) => privateValue(value);
` });
  const result = transform(root, "source.ts", { replay: true });
  assert.ok(names(result).includes("privateValue"));
  assert.ok(names(result).includes("owner.nested"));
  assert.ok(!names(result).includes("owner.captured"));
  assert.ok(result.diagnostics.some((item) => item.code === "CLOSURE_CAPTURE"));
  const module = await load(root, result);
  const nested = result.targets.find((target) => target.locator.namePath.join(".") === "owner.nested");
  assert.equal(module[nested.replayExport](2), 5);
  assert.equal(module.entry(4), 12);
  const shifted = transform(root, "source.ts", { code: "\n// unrelated comment\n" + readFileSync(path.join(root, "source.ts"), "utf8"), replay: true });
  assert.deepEqual(shifted.targets, result.targets);
});

test("normal transforms add no private or synthetic exports; replay alone exposes locators", async (t) => {
  const root = project(t, { "source.ts": `function hidden(n: number) { return n + 1; } export function entry(n: number) { return hidden(n); }` });
  const normal = transform(root);
  const module = await load(root, normal);
  assert.deepEqual(Object.keys(module), ["entry"]);
  assert.ok(!normal.code.includes("export { hidden"));
  assert.ok(normal.map);
  const replay = transform(root, "source.ts", { replay: true });
  const replayed = await load(root, replay);
  for (const target of replay.targets) assert.equal(typeof replayed[target.replayExport], "function");
});

test("captures exact builtin operations and aliases, and replays without invoking natives", async (t) => {
  const root = project(t, { "source.ts": `
import { randomUUID as uuid } from "node:crypto";
import { performance as perf } from "node:perf_hooks";
const { random: sample } = Math;
export function entry() {
  const now = Date.now;
  return [sample(), uuid(), now(), Date(), new Date(), perf.now(), process.env.REPLAYLOCK_TEST_COLOR];
}` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const original = module.entry();
  assert.deepEqual(blocks, []);
  assert.equal(observations.length, 1);
  assert.deepEqual(ops(observations[0]), ["Math.random", "crypto.randomUUID", "Date.now", "Date", "new Date", "performance.now", "process.env"]);
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.deepEqual(await replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport]()), original); }
  finally { Math.random = random; }
});

test("overlapping async calls retain context after awaits and join Promise.all effects", async (t) => {
  const root = project(t, { "source.ts": `
async function child(n: number) { await Promise.resolve(0); return n + Math.random(); }
export async function entry(n: number) {
  await Promise.resolve(0);
  const first = await child(n);
  const pair = await Promise.all([child(n + 1), child(n + 2)]);
  return [first, pair[0], pair[1], Date.now()];
}` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const values = await Promise.all([module.entry(1), module.entry(10)]);
  await Promise.resolve();
  assert.deepEqual(blocks, []);
  const parents = observations.filter((item) => item.locator.namePath[0] === "entry");
  assert.equal(parents.length, 2);
  for (let i = 0; i < parents.length; i++) {
    assert.deepEqual(ops(parents[i]), ["Math.random", "Math.random", "Math.random", "Date.now"]);
    const args = decodeDevValue(parents[i].arguments);
    assert.deepEqual(await replayDevTrace(parents[i].trace, () => module.entry(...args)), values[args[0] === 1 ? 0 : 1]);
  }
});

test("file and fetch readers use native signatures and replay offline", async (t) => {
  const root = project(t, { "source.ts": `
import { readFileSync as read } from "node:fs";
import { readFile as readAsync } from "node:fs/promises";
export async function entry(file: string, url: string) {
  const sync = read(file, "utf8");
  const asyncText = await readAsync(file, "utf8");
  const response = await fetch(url);
  const text = await response.text();
  return [sync, asyncText, text];
}` });
  const file = path.join(root, "data.txt"); writeFileSync(file, "file-value");
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const original = await module.entry(file, "data:text/plain,network-value");
  await Promise.resolve();
  assert.deepEqual(blocks, []);
  assert.equal(observations.length, 1);
  assert.deepEqual(ops(observations[0]), ["fs.readFileSync", "fs.readFile", "fetch", "Response.text"]);
  rmSync(file);
  const fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("offline"); };
  try { assert.deepEqual(await replayDevTrace(observations[0].trace, () => module.entry(file, "data:text/plain,network-value")), original); }
  finally { globalThis.fetch = fetch; }
});

test("blocked syntax is never rewritten into apparent effect coverage", (t) => {
  const fixtures = [
    [`export function entry(input: {value: number}) { input.value++; return Math.random(); }`, "ARGUMENT_MUTATION"],
    [`let counter = 0; export function entry() { counter++; return Math.random(); }`, "AMBIENT_MUTATION"],
    [`const boot = Date.now(); export function entry() { return boot; }`, "EFFECTFUL_INITIALIZATION"],
    [`export function entry() { return unknown(); }`, "UNKNOWN_CALL"],
    [`export function entry(Math: {random(): number}) { return Math.random(); }`, "UNKNOWN_CALL"],
    [`export function entry(value = Date.now()) { return value; }`, "UNSUPPORTED_CALLABLE"],
    [`export function entry() { setTimeout(() => Math.random(), 1); return 0; }`, "UNKNOWN_CALL"],
    [`export async function entry() { return await Promise.race([fetch("x"), fetch("y")]); }`, "UNKNOWN_CALL"],
    [`export async function entry() { fetch("x"); return 0; }`, "DETACHED_ASYNC"],
    [`import { readFile } from "node:fs"; export function entry() { readFile("x", () => 0); }`, "UNKNOWN_CALL"],
    [`export async function entry(response: Response) { return await response.json(); }`, "UNKNOWN_CALL"],
    [`export function entry() { return process.env.NOT_APPROVED; }`, "ENVIRONMENT_DEPENDENCE"],
  ];
  for (const [source, code] of fixtures) {
    const root = project(t, { "source.ts": source });
    const result = transform(root, "source.ts", { replay: true });
    assert.deepEqual(result.targets, [], source);
    assert.ok(result.diagnostics.some((item) => item.code === code), `${code}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.code, source);
  }
});

test("implicitly invoked functions and untraced host reads cannot hide effects", (t) => {
  const fixtures = [
    [`export function entry(n: number) { return String({ toString() { return String(Math.random()); } }) + n; }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { return n + ({ valueOf() { return Date.now(); } } as unknown as number); }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { return \`\${{ toString: () => String(Math.random()) }}\${n}\`; }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { let t = n; for (const x of { *[Symbol.iterator]() { yield Math.random(); } } as unknown as number[]) t += x; return t; }`, "FUNCTION_VALUE"],
    [`import { writeFileSync } from "node:fs"; export function entry(n: number) { return String({ toString() { writeFileSync("x", "y"); return "s"; } }) + n; }`, "FUNCTION_VALUE"],
    [`function helper() { return String(Math.random()); } export function entry(n: number) { return String({ toString: helper }) + n; }`, "FUNCTION_VALUE"],
    [`function helper() { return String(Math.random()); } export function entry(n: number) { return helper.call(null) + n; }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { return String({ toString: Math.random }) + n; }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { const now = Date.now; return String({ toString: now }) + n; }`, "FUNCTION_VALUE"],
    [`export function entry(n: number) { return String({ toString: process.exit }) + n; }`, "AMBIENT_STATE"],
    [`import os from "node:os"; export function entry(n: number) { return String({ toString: os.hostname }) + n; }`, "AMBIENT_STATE"],
    [`export function entry(n: number) { return process.argv.length + n; }`, "AMBIENT_STATE"],
    [`export function entry(n: number) { return (Math as unknown as { patched: number }).patched + n; }`, "AMBIENT_STATE"],
    [`export function entry(n: number, key: string) { return (Math as unknown as Record<string, number>)[key] ?? n; }`, "AMBIENT_STATE"],
  ];
  for (const [source, code] of fixtures) {
    const root = project(t, { "source.ts": source });
    const result = transform(root, "source.ts", { replay: true });
    assert.deepEqual(result.targets.filter((target) => target.locator.namePath[0] === "entry"), [], source);
    assert.ok(result.diagnostics.some((item) => item.code === code && item.locator.namePath[0] === "entry"), `${code}: ${JSON.stringify(result.diagnostics)}`);
  }
  const root = project(t, { "source.ts": `function helper(n: number) { return n + Math.random(); }
export function entry(n: number) { const now = Date.now; function inner(x: number) { return x * Math.PI; } return helper(inner(n)) + now() + Number.MAX_SAFE_INTEGER + (typeof window === "undefined" ? 0 : 1) + (n === undefined ? NaN : 0); }` });
  assert.deepEqual(names(transform(root, "source.ts")), ["helper", "entry", "entry.inner"]);
});

test("catalogued built-ins and inert module tables replay offline without tainting their module", async (t) => {
  const root = project(t, { "source.ts": `
const LIMITS = new Map([["small", 1], ["large", 3]]);
const UNITS = Object.freeze({ kg: 1, lb: 0.5 });
const PATTERN = new RegExp("^[a-z]+$", "i");
export function entry(record: Record<string, number>, href: string) {
  const copy = JSON.parse(JSON.stringify(record));
  return [Object.keys(copy).length, Object.entries(copy).length, new URL(href).pathname, encodeURIComponent(href), [...new Set(Object.values(copy))].length, Array.from("ab").length, Math.random()];
}` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(names(result), ["entry"]);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const original = module.entry({ a: 1, b: 1 }, "https://example.test/a b");
  assert.deepEqual(blocks, []);
  assert.deepEqual(ops(observations[0]), ["Math.random"]);
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.deepEqual(await replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport]({ a: 1, b: 1 }, "https://example.test/a b")), original); }
  finally { Math.random = random; }
  const refused = [
    [`import { entries } from "./entries"; const TABLE = new Map(entries as never); export function entry(k: string) { return TABLE.size + k.length; }`, "EFFECTFUL_INITIALIZATION"],
    [`const TABLE = new Map([["a", Date.now()]]); export function entry(k: string) { return TABLE.size + k.length; }`, "EFFECTFUL_INITIALIZATION"],
    [`const TABLE = JSON.parse("{}", (key, value) => value); export function entry(k: string) { return TABLE + k; }`, "EFFECTFUL_INITIALIZATION"],
    [`const TABLE = Object.freeze({ get now() { return Date.now(); } }); export function entry(k: string) { return TABLE.now + k.length; }`, "EFFECTFUL_INITIALIZATION"],
    [`export function entry(value: { a: number }) { const freeze = Object.freeze; return freeze(value); }`, "UNKNOWN_CALL"],
    [`export function entry(value: { a: number }) { return Object.freeze(value); }`, "ARGUMENT_MUTATION"],
    [`export function entry(text: string, keys: string[]) { return JSON.stringify(text, keys); }`, "UNKNOWN_CALL"],
    [`export function entry(values: number[]) { return Array.from(values, (value) => value * 2); }`, "UNKNOWN_CALL"],
  ];
  for (const [source, code] of refused) {
    const blocked = project(t, { "source.ts": source, "entries.ts": `export const entries = { *[Symbol.iterator]() { yield ["a", Math.random()]; } };` });
    const refusal = transform(blocked, "source.ts", { replay: true });
    assert.deepEqual(names(refusal), [], source);
    assert.ok(refusal.diagnostics.some((item) => item.code === code), `${code}: ${JSON.stringify(refusal.diagnostics)}`);
  }
});

test("module-private literal tables are read like scalars and replay offline", async (t) => {
  const root = project(t, { "source.ts": `
const LABELS = { draft: "Draft", published: "Published" } as const;
const FACTORS = Object.freeze({ kg: 1, lb: 0.5 });
const SIZES = [1, 2, 3];
export function entry(status: keyof typeof LABELS, unit: "kg" | "lb") {
  let total = 0;
  for (const size of SIZES) total += size;
  return [LABELS[status], FACTORS[unit] * total, "kg" in FACTORS, Object.keys(LABELS).length, [...SIZES].length, SIZES.length, Math.random()];
}` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, result);
  const { observations } = capture();
  const original = module.entry("draft", "lb");
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.deepEqual(await replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport]("draft", "lb")), original); }
  finally { Math.random = random; }
  const refused = [
    `const T = { a: 1 }; export function entry() { return T; }`,
    `const T = { a: 1 }; function change(value: { a: number }) { value.a = 2; } export function entry() { change(T); return T.a; }`,
    `const T = { a: 1 }; export function grow() { T.a = 2; } export function entry() { return T.a; }`,
    `const T = { a: 1 }; export function entry() { (T as { a: number }).a++; return T.a; }`,
    `const T = { a: 1 }; export function entry() { const alias = T; alias.a = 2; return T.a; }`,
    `const T = [1]; export function entry() { [T[0]] = [2]; return T[0]; }`,
    `const T = { inner: { a: 1 } }; export function entry() { return T.inner.a; }`,
    `const T = { a: 1, get b() { return Date.now(); } }; export function entry() { return T.a; }`,
    `export const T = { a: 1 }; export function entry() { return T.a; }`,
    `const T = { a: 1 }; export { T }; export function entry() { return T.a; }`,
    `const T = { a: 1 }; export function entry() { return (T as unknown as { constructor: unknown }).constructor; }`,
    `let T = { a: 1 }; export function entry() { return T.a; }`,
  ];
  for (const source of refused) {
    const blocked = project(t, { "source.ts": source });
    const refusal = transform(blocked, "source.ts", { replay: true });
    assert.ok(!names(refusal).includes("entry"), source);
    assert.ok(refusal.diagnostics.some((item) => item.code === "AMBIENT_STATE" && item.locator.namePath[0] === "entry"), `${source}: ${JSON.stringify(refusal.diagnostics)}`);
  }
});

test("subpath imports, host conditions, and asset imports resolve like Vite without admitting their values", (t) => {
  const files = {
    "package.json": '{"type":"module","imports":{"#lib/*":"./lib/*.ts"}}',
    "lib/math.ts": "export function double(n: number) { return n * 2; }",
    "styles.css": "body { margin: 0; }",
    "data.json": '{"limit": 3}',
    "node_modules/conditional/package.json": '{"name":"conditional","type":"module","exports":{".":{"react-server":"./server.js","module-sync":"./sync.js","import":"./index.js"}}}',
    "node_modules/conditional/index.js": "export function tag(value) { return value; }",
    "node_modules/conditional/server.js": "globalThis.serverOnly = Date.now(); export function tag(value) { return value; }",
    "node_modules/conditional/sync.js": "globalThis.syncOnly = Date.now(); export function tag(value) { return value; }",
    "source.ts": `import { double } from "#lib/math";
import { tag } from "conditional";
import "./styles.css";
import url from "./styles.css?url";
export function entry(n: number) { return tag(double(n)); }`,
  };
  const conditions = { node: ["module", "node", "development"], browser: ["module", "browser", "development"] };
  const root = project(t, files);
  const hosted = transform(root, "source.ts", { options: { ...defaults, resolveConditions: conditions } });
  assert.ok(names(hosted).includes("entry"), JSON.stringify(hosted.diagnostics));
  // Without the host's conditions, an unknown condition cannot be guessed.
  const unhosted = transform(root, "source.ts");
  assert.ok(unhosted.diagnostics.some((item) => item.code === "UNKNOWN_MODULE" && item.locator.namePath[0] === "entry"));
  const refused = [
    `import data from "./data.json"; export function entry() { return data.limit; }`,
    `import url from "./styles.css?url"; export function entry() { return url; }`,
    `import Worker from "./lib/math.ts?worker"; export function entry() { return typeof Worker; }`,
    `import { missing } from "#lib/math"; export function entry() { return missing; }`,
    `import { value } from "#nothing/here"; export function entry() { return value; }`,
  ];
  for (const source of refused) {
    const blocked = project(t, { ...files, "source.ts": source });
    const refusal = transform(blocked, "source.ts", { options: { ...defaults, resolveConditions: conditions } });
    assert.ok(!names(refusal).includes("entry"), source);
    assert.ok(refusal.diagnostics.some((item) => item.code === "UNKNOWN_MODULE" && item.locator.namePath[0] === "entry"), `${source}: ${JSON.stringify(refusal.diagnostics)}`);
  }
});

test("a replaced built-in blocks capture and fails replay instead of running natively", async (t) => {
  const root = project(t, { "source.ts": `export function entry(value: { a: number }) { return JSON.stringify(value) + Math.random(); }` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(names(result), ["entry"]);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const stringify = JSON.stringify;
  JSON.stringify = (...args) => stringify(...args);
  try { assert.match(module.entry({ a: 1 }), /^\{"a":1\}/); }
  finally { JSON.stringify = stringify; }
  assert.deepEqual(blocks.map((item) => item.code), ["INTRINSIC_MODIFIED"]);
  assert.equal(observations.length, 0);
  const original = module.entry({ a: 1 });
  assert.equal(observations.length, 1);
  Array.prototype.polluted = true;
  try { await assert.rejects(replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport]({ a: 1 })), /INTRINSIC_MODIFIED/); }
  finally { delete Array.prototype.polluted; }
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.equal(await replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport]({ a: 1 })), original); }
  finally { Math.random = random; }
});

test("module initialization taints only what can observe it, and unobserved initializers replay offline", async (t) => {
  const files = {
    "package.json": '{"type":"module"}',
    "node_modules/schema/package.json": '{"name":"schema","type":"module","exports":"./index.js"}',
    "node_modules/schema/index.js": "const defaults = Object.freeze({ strict: true }); function create(kind) { return { kind, ...defaults }; } export const s = { object: () => create('object') };",
    "clock.ts": "export const bootedAt = Date.now(); export const later = bootedAt + 1;",
    "source.ts": `import { s } from "schema";
import { later } from "./clock";
import * as clock from "./clock";
const boot = Date.now();
export const userSchema = s.object();
const { MODE } = process.env;
export function entry(n: number) { return n * 2 + Math.random(); }
export function readsBoot(n: number) { return n + boot; }
export function readsSchema() { return userSchema.kind; }
export function readsLater(n: number) { return n + later; }
export function readsNamespace(n: number) { return n + clock.bootedAt; }
export function readsMode() { return MODE ?? ""; }`,
  };
  const root = project(t, files);
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(names(result), ["entry"]);
  for (const name of ["readsBoot", "readsSchema", "readsLater", "readsNamespace", "readsMode"]) {
    assert.ok(result.diagnostics.some((item) => item.code === "EFFECTFUL_INITIALIZATION" && item.locator.namePath[0] === name), `${name}: ${JSON.stringify(result.diagnostics)}`);
  }
  // Initializers run natively when replay imports the module, but the case never observes them.
  const replayRoot = project(t, { ...files, "source.ts": `import { s } from "schema";
const boot = Date.now();
export const userSchema = s.object();
export function entry(n: number) { return n * 2 + Math.random(); }
export function readsBoot(n: number) { return n + boot; }` });
  const replayable = transform(replayRoot, "source.ts", { replay: true });
  assert.deepEqual(names(replayable), ["entry"]);
  const module = await load(replayRoot, replayable);
  const { observations } = capture();
  const original = module.entry(4);
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.equal(await replayDevTrace(observations[0].trace, () => module[replayable.targets[0].replayExport](4)), original); }
  finally { Math.random = random; }
  const global = [
    `console.log("loaded"); export function entry(n: number) { return n; }`,
    `setInterval(() => undefined, 1000); export function entry(n: number) { return n; }`,
    `(Array.prototype as unknown as { x: number }).x = 1; export function entry(n: number) { return n; }`,
    `(globalThis as unknown as { onerror: null }).onerror = null; export function entry(n: number) { return n; }`,
    `import "./setup"; export function entry(n: number) { return n; }`,
    `import { flag } from "./patch"; export function entry(n: number) { return n; }`,
    `function register(name: string) { return name; } register("x"); export function entry(n: number) { return n; }`,
  ];
  for (const source of global) {
    const blocked = project(t, { ...files, "source.ts": source, "setup.ts": `import { s } from "schema"; s.object(); export const ready = true;`, "patch.ts": `Object.defineProperty(Object.prototype, "x", { value: 1 }); export const flag = 1;` });
    const refusal = transform(blocked, "source.ts", { replay: true });
    assert.deepEqual(names(refusal), [], source);
    assert.ok(refusal.diagnostics.some((item) => item.code === "EFFECTFUL_INITIALIZATION"), `${source}: ${JSON.stringify(refusal.diagnostics)}`);
  }
  const privateRegistration = project(t, { ...files, "source.ts": `(globalThis as unknown as { __version: string }).__version = "1"; export function entry(n: number) { return n; }` });
  assert.deepEqual(names(transform(privateRegistration, "source.ts")), [], "an unbound statement still taints its own module");
});

test("built-in methods and callbacks replay offline with traced callback effects; their targets refuse adapted values", async (t) => {
  const root = project(t, { "source.ts": `
export function entry(path: string, values: number[], record: Record<string, number>) {
  const parts = path.trim().split(":").map((part) => part.length);
  const sorted = [...values].sort((a, b) => a - b);
  const counts: Record<string, number> = {};
  values.forEach((value) => { counts[value] = (counts[value] ?? 0) + 1; });
  const out: number[] = [];
  for (const value of values) if (value > 1) out.push(value);
  return [parts, sorted, values.reduce((a, b) => a + b, 0), Object.keys(record).sort(), (values[0] ?? 0).toFixed(2), values.filter(Boolean), counts, out, /^a/.test(path.trim()), Math.random()];
}
export function label(value: unknown) { return JSON.stringify(value); }
export function echo(value: unknown) { return value; }` });
  const result = transform(root, "source.ts", { replay: true });
  assert.deepEqual(result.diagnostics, []);
  const requirement = (name) => result.targets.find((target) => target.locator.namePath[0] === name).requires;
  assert.deepEqual(requirement("entry"), ["plainValues"]);
  assert.deepEqual(requirement("label"), ["plainValues"]);
  assert.equal(requirement("echo"), undefined);
  const module = await load(root, result);
  const { observations, blocks } = capture();
  const original = module.entry(" a:bb ", [3, 1, 2], { b: 1, a: 2 });
  assert.deepEqual(blocks, []);
  assert.deepEqual(ops(observations[0]), ["Math.random"]);
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try { assert.deepEqual(await replayDevTrace(observations[0].trace, () => module[result.targets[0].replayExport](" a:bb ", [3, 1, 2], { b: 1, a: 2 })), original); }
  finally { Math.random = random; }
  // An adapted instance's methods would run natively inside JSON.stringify.
  class Amount { constructor(value) { this.value = value; } toJSON() { return Date.now(); } }
  const adapted = { observations: [], blocks: [] };
  configureDevRuntime({ adapters: [{ id: "amount", version: 1, type: Amount, serialize: (value) => value.value, deserialize: (value) => new Amount(value) }], onObservation: (value) => adapted.observations.push(value), onBlock: (value) => adapted.blocks.push(value) });
  module.label(new Amount(1));
  assert.deepEqual(adapted.blocks.map((item) => item.code), ["UNSUPPORTED_VALUE"]);
  module.echo(new Amount(1));
  assert.equal(adapted.observations.length, 1);
  assert.equal(adapted.observations[0].locator.namePath[0], "echo");
  // Effects inside callbacks, and in project functions they call, are traced against the caller's frame.
  const traced = project(t, { "source.ts": `function noisy(value: number) { return value + Date.now(); }
export function entry(values: number[]) { return [values.map((value) => value + Math.random()), values.map((value) => noisy(value)), [...values].sort(() => Math.random() - 0.5)]; }` });
  const tracedResult = transform(traced, "source.ts", { replay: true });
  assert.deepEqual(tracedResult.diagnostics, []);
  const tracedModule = await load(traced, tracedResult);
  const tracedCapture = capture();
  const tracedOriginal = tracedModule.entry([1, 2, 3]);
  const entryObservation = tracedCapture.observations.find((item) => item.locator.namePath[0] === "entry");
  assert.deepEqual(ops(entryObservation).slice(0, 6), ["Math.random", "Math.random", "Math.random", "Date.now", "Date.now", "Date.now"]);
  assert.ok(ops(entryObservation).slice(6).every((operation) => operation === "Math.random"));
  const saved = { random: Math.random, now: Date.now };
  Math.random = Date.now = () => { throw new Error("native effect during replay"); };
  try { assert.deepEqual(await replayDevTrace(entryObservation.trace, () => tracedModule[tracedResult.targets.find((item) => item.locator.namePath[0] === "entry").replayExport]([1, 2, 3])), tracedOriginal); }
  finally { Math.random = saved.random; Date.now = saved.now; }
  const refused = [
    [`export function entry(values: { n: number }[]) { values.forEach((value) => { value.n++; }); return 0; }`, "ARGUMENT_MUTATION"],
    [`let total = 0; export function entry(values: number[]) { values.forEach((value) => { total += value; }); return 0; }`, "AMBIENT_MUTATION"],
    [`export function entry(values: number[]) { return values.sort(); }`, "ARGUMENT_MUTATION"],
    [`export function entry(input: { items: number[] }) { const items = input.items; items.push(1); return items.length; }`, "UNKNOWN_CALL"],
    [`export function entry(values: number[], transform: (value: number) => number) { return values.map(transform); }`, "UNKNOWN_CALL"],
    [`export function entry(values: number[]) { return values.map(async (value) => value); }`, "FUNCTION_VALUE"],
    [`export function entry(values: number[]) { return values.map(function (this: { k: number }, value) { return value + this.k; }); }`, "RECEIVER_DEPENDENCE"],
    [`export function entry(text: string) { return /a/g.test(text); }`, "UNKNOWN_CALL"],
    [`export function entry(value: { custom(): number }) { return value.custom(); }`, "UNKNOWN_CALL"],
    [`export function entry(values: { a: number }[]) { values.forEach((value) => Object.freeze(value)); return 0; }`, "ARGUMENT_MUTATION"],
  ];
  for (const [source, code] of refused) {
    const blocked = project(t, { "source.ts": source });
    const refusal = transform(blocked, "source.ts", { replay: true });
    assert.ok(!names(refusal).includes("entry"), source);
    assert.ok(refusal.diagnostics.some((item) => item.code === code && item.locator.namePath[0] === "entry"), `${code}: ${source}: ${JSON.stringify(refusal.diagnostics)}`);
  }
});

test("destructured and literal-default parameters keep their semantics and replay offline", async (t) => {
  const root = project(t, { "source.ts": `
export const meta = ({ title }: { title: string }) => [{ title: title + " | Notes" }];
export const scaled = ([a, b]: number[], factor = 2, ...rest: number[]) => (a + b) * factor + rest.length + Math.random();
export function page({ page = 1, size = 20 } = {}, offset = 0) { return [(page - 1) * size + offset, Math.random()]; }
export function owner(n: number) { const inner = ({ x = 1 }: { x?: number }, y = 3) => x + y + n; return 0; }
export function outer() { const nested = ({ v = 1 }: { v?: number }) => v * 2; return nested({}); }` });
  const result = transform(root, "source.ts", { replay: true });
  for (const name of ["meta", "scaled", "page", "outer", "outer.nested"]) assert.ok(names(result).includes(name), `${name}: ${JSON.stringify(result.diagnostics)}`);
  const module = await load(root, result);
  assert.equal(module.scaled.length, 1);
  assert.equal(module.page.length, 0);
  const { observations } = capture();
  const cases = [["meta", [{ title: "A", other: 1 }]], ["scaled", [[1, 2], undefined, 7, 8]], ["page", [{ size: 5 }]], ["page", []]];
  const originals = cases.map(([name, args]) => module[name](...args));
  assert.deepEqual(originals[0], [{ title: "A | Notes" }]);
  const random = Math.random;
  Math.random = () => { throw new Error("native randomness during replay"); };
  try {
    for (const [index, [name, args]] of cases.entries()) {
      const observation = observations.filter((item) => item.locator.namePath.join(".") === name)[cases.slice(0, index).filter(([other]) => other === name).length];
      const target = result.targets.find((item) => item.locator.namePath.join(".") === name);
      assert.deepEqual(await replayDevTrace(observation.trace, () => module[target.replayExport](...args)), originals[index], name);
    }
  } finally { Math.random = random; }
  const nested = result.targets.find((item) => item.locator.namePath.join(".") === "outer.nested");
  assert.equal(module[nested.replayExport]({}), 2);
  assert.equal(module[nested.replayExport]({ v: 4 }), 8);
  for (const source of [
    `export function entry(value = Date.now()) { return value; }`,
    `const LIMIT = { max: 1 }; export function entry(value = LIMIT.max) { return value; }`,
    `export const entry = ({ at = Date.now() }: { at?: number }) => at;`,
    `export function entry({ [String(Math.random())]: value }: Record<string, number>) { return value; }`,
  ]) {
    const blocked = transform(project(t, { "source.ts": source }), "source.ts");
    assert.ok(!names(blocked).includes("entry"), source);
    assert.ok(blocked.diagnostics.some((item) => item.code === "UNSUPPORTED_CALLABLE"), source);
  }
});

test("source policies, selection, and disabled effects cannot be bypassed by callers", (t) => {
  const root = project(t, {
    "source.ts": `/** @replaylock exclude hidden effects */
function excluded() { return Math.random(); }
export function entry() { return excluded(); }
/** @replaylock capture */
export function safe(n: number) { return n + 1; }
export function other(n: number) { return n - 1; }`,
    "ignored.ts": `export function ignored() { return Math.random(); }`,
  });
  assert.deepEqual(names(transform(root)), ["safe", "other"]);
  assert.deepEqual(names(transform(root, "source.ts", { options: { ...defaults, capture: { mode: "annotated", include: ["source.ts"], exclude: [] } } })), ["safe"]);
  assert.deepEqual(transform(root, "ignored.ts", { options: { ...defaults, capture: { mode: "automatic", include: ["**/*.ts"], exclude: ["ignored.ts"] } } }).targets, []);
  assert.deepEqual(transform(root, "ignored.ts", { options: { ...defaults, effects: { ...defaults.effects, randomness: false } } }).targets, []);
});

test("project imports resolve bindings and initialization; dependency and root edits invalidate HMR digests", (t) => {
  const root = project(t, {
    "source.ts": `import { helper as add } from "./helper.js"; export function entry(n: number) { return add(n); }`,
    "helper.ts": `export function helper(n: number) { return n + 1; }`,
    "other.ts": `export const other = (n: number) => n;`,
  });
  const first = transform(root);
  assert.deepEqual(names(first), ["entry"]);
  assert.equal(first.sourceGraphDigest, analyzeDevProject(root, defaults, "node").sourceGraphDigest);
  put(root, "helper.ts", `export function helper(n: number) { return n + 2; }`);
  const dependencyEdit = transform(root);
  assert.notEqual(dependencyEdit.sourceGraphDigest, first.sourceGraphDigest);
  put(root, "other.ts", `export const other = (n: number) => n + 1;`);
  assert.notEqual(transform(root).sourceGraphDigest, dependencyEdit.sourceGraphDigest);
  put(root, "helper.ts", `const boot = Date.now(); export function helper(n: number) { return n + boot; }`);
  assert.deepEqual(transform(root).targets, []);
});

test("Node package exports resolve real source code, hash dependencies, and block unknown or untransformed package effects", (t) => {
  const root = project(t, {
    "source.ts": `import { helper } from "fixture-package"; export function entry(n: number) { return helper(n); }`,
    "node_modules/fixture-package/package.json": '{"name":"fixture-package","type":"module","exports":"./implementation.js"}',
    "node_modules/fixture-package/implementation.js": `export function helper(n) { return n + 2; }`,
  });
  const first = transform(root);
  assert.deepEqual(names(first), ["entry"]);
  put(root, "node_modules/fixture-package/implementation.js", `export function helper(n) { return n + 3; }`);
  assert.notEqual(transform(root).sourceGraphDigest, first.sourceGraphDigest);
  put(root, "node_modules/fixture-package/implementation.js", `export function helper(n) { return n + Math.random(); }`);
  assert.deepEqual(transform(root).targets, []);
});

test("shadowed aliases, captures, ambiguous lexical paths, and excluded owners stay conservative", (t) => {
  const root = project(t, { "source.ts": `
export function owner(outer: number) {
  const local = 4;
  function readsLocal(n: number) { return n + local; }
  function readsReceiver() { return this.value; }
  function shadow(Math: {random(): number}) { return Math.random(); }
  if (outer) { function repeated(n: number) { return n + 1; } }
  else { function repeated(n: number) { return n + 2; } }
}
/** @replaylock exclude no capture in this subtree */
export function excluded() { function hidden() { return Math.random(); } return hidden(); }
` });
  const result = transform(root, "source.ts", { replay: true });
  for (const name of ["owner.readsLocal", "owner.readsReceiver", "owner.shadow", "owner.repeated", "excluded", "excluded.hidden"]) assert.ok(!names(result).includes(name), name);
});

test("native receiver, method, and arguments are evaluated once in source order, including awaited arguments", async (t) => {
  const root = project(t, { "source.ts": `export async function entry() {
  const response = await globalThis.fetch("data:text/plain," + String(Date.now()) + await Promise.resolve("-tail"));
  return await response.text();
}` });
  const result = transform(root);
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, result);
  const events = [];
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const nowDescriptor = Object.getOwnPropertyDescriptor(Date, "now");
  Object.defineProperty(globalThis, "fetch", { configurable: true, get() {
    events.push("fetch-get");
    return function (url) { assert.equal(this, globalThis); events.push(`fetch-call:${url}`); return Promise.resolve(new Response(url.slice("data:text/plain,".length))); };
  } });
  Object.defineProperty(Date, "now", { configurable: true, get() {
    events.push("now-get");
    return function () { assert.equal(this, Date); events.push("now-call"); return 42; };
  } });
  try {
    assert.equal(await module.entry(), "42-tail");
    assert.deepEqual(events, ["fetch-get", "now-get", "now-call", "fetch-call:data:text/plain,42-tail"]);
  } finally {
    Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    Object.defineProperty(Date, "now", nowDescriptor);
  }
});

test("browser environment and every Response reader use the frozen operation signatures", async (t) => {
  const root = project(t, { "source.ts": `export async function entry() {
  const jsonResponse = await fetch('data:application/json,%7B%22value%22%3A2%7D');
  const json = await jsonResponse.json();
  const bytesResponse = await fetch('data:text/plain,bytes');
  const bytes = await bytesResponse.arrayBuffer();
  return [json.value, bytes, import.meta.env.MODE];
}` });
  const result = transform(root, "source.ts", { environment: "browser", replay: true });
  assert.deepEqual(result.diagnostics, []);
  const module = await load(root, { ...result, code: result.code.replace("() => import.meta.env.MODE", '() => "test"') });
  const { observations, blocks } = capture();
  const original = await module.entry();
  await Promise.resolve();
  assert.deepEqual(blocks, []);
  assert.deepEqual(ops(observations[0]), ["fetch", "Response.json", "fetch", "Response.arrayBuffer", "import.meta.env"]);
  assert.deepEqual(await replayDevTrace(observations[0].trace, () => module.entry()), original);
  assert.equal(transform(root, "source.ts", { environment: "browser", code: `export function entry() { return process.env.REPLAYLOCK_TEST_COLOR; }` }).targets.length, 0);
});

test("conditional package exports use the import source and manifest changes invalidate the graph", (t) => {
  const root = project(t, {
    "source.ts": `import { helper } from "conditional-package"; export function entry(n: number) { return helper(n); }`,
    "node_modules/conditional-package/package.json": '{"name":"conditional-package","type":"module","exports":{"require":"./unsafe.cjs","import":"./safe.js"}}',
    "node_modules/conditional-package/safe.js": `export function helper(n) { return n + 1; }`,
    "node_modules/conditional-package/unsafe.cjs": `throw new Error("must never load");`,
  });
  const first = transform(root);
  assert.deepEqual(names(first), ["entry"]);
  put(root, "node_modules/conditional-package/package.json", '{"name":"conditional-package","version":"2","type":"module","exports":{"require":"./unsafe.cjs","import":"./safe.js"}}');
  assert.notEqual(transform(root).sourceGraphDigest, first.sourceGraphDigest);
});

test("untraced ambient snapshots, module getters, and inaccessible block functions cannot become replay targets", (t) => {
  for (const source of [
    `const initial = process.env.REPLAYLOCK_TEST_COLOR; export function entry() { return initial; }`,
    `const values = { get value() { return Math.random(); } }; export function entry() { return values.value; }`,
    `export function entry() { const values = { get value() { return Math.random(); } }; return values.value; }`,
    `export function entry() { return globalThis.customAmbient; }`,
    `export function entry() { return missingAmbient; }`,
    `if (true) { function blockOnly() { return 1; } }`,
  ]) {
    const root = project(t, { "source.ts": source });
    assert.deepEqual(transform(root, "source.ts", { replay: true }).targets, [], source);
  }
  const root = project(t, {
    "source.ts": `import { initial } from "./snapshot.js"; export function entry() { return initial; }`,
    "snapshot.ts": `export const initial = process.env.REPLAYLOCK_TEST_COLOR;`,
  });
  assert.deepEqual(transform(root).targets, []);
});

test("object shorthand, siblings, and mutable objects do not hide enclosing or ambient captures", (t) => {
  const root = project(t, { "source.ts": `
const settings = { value: 2 };
export function owner(outer: number) {
  function sibling(n: number) { return n + 1; }
  function capturesSibling(n: number) { return sibling(n); }
  function shorthand() { return { outer }; }
  function readsObject() { return settings.value; }
}
export function mutate() { settings.value++; }
` });
  const result = transform(root, "source.ts", { replay: true });
  assert.ok(names(result).includes("owner.sibling"));
  for (const name of ["owner.capturesSibling", "owner.shorthand", "owner.readsObject", "mutate"]) assert.ok(!names(result).includes(name), name);
});

test("unresolved Vite-only aliases and excluded dependency effects fail closed", (t) => {
  const root = project(t, {
    "source.ts": `import { helper } from "@app/helper"; export function entry() { return helper(); }`,
    "helper.ts": `export function helper() { return Math.random(); }`,
  });
  const unresolved = transform(root);
  assert.deepEqual(unresolved.targets, []);
  assert.ok(unresolved.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_MODULE"));
  put(root, "source.ts", `import { helper } from "./helper.js"; export function entry() { return helper(); }`);
  const excluded = transform(root, "source.ts", { options: { ...defaults, capture: { mode: "automatic", include: ["source.ts"], exclude: [] } } });
  assert.deepEqual(excluded.targets, []);
  assert.ok(excluded.diagnostics.some((diagnostic) => diagnostic.code === "UNINSTRUMENTED_EFFECT"));
});

test("resolved Vite string aliases support exact and slash-prefix matches and affect HMR identity", (t) => {
  const root = project(t, {
    "source.ts": `import { helper } from "@app/helper"; import { value } from "config"; export function entry() { return helper(value); }`,
    "app/helper.ts": `export function helper(n: number) { return n + 1; }`,
    "app/alternate.ts": `export function helper(n: number) { return n + 2; }`,
    "settings.ts": `export const value = 2;`,
  });
  const options = { ...defaults, resolveAliases: [{ find: "@app", replacement: path.join(root, "app") }, { find: "config", replacement: path.join(root, "settings.ts") }] };
  const result = transform(root, "source.ts", { options });
  assert.deepEqual(names(result), ["entry"]);
  assert.equal(result.sourceGraphDigest, analyzeDevProject(root, options, "node").sourceGraphDigest);
  const changed = transform(root, "source.ts", { options: { ...options, resolveAliases: [{ find: "@app/helper", replacement: path.join(root, "app/alternate.ts") }, ...options.resolveAliases] } });
  assert.deepEqual(names(changed), ["entry"]);
  assert.notEqual(changed.sourceGraphDigest, result.sourceGraphDigest);
  assert.deepEqual(transform(root, "source.ts", { options, code: `import {helper} from "@application/helper"; export function entry() { return helper(1); }` }).targets, []);
  assert.deepEqual(transform(root, "source.ts", { options: { ...defaults, resolveAliases: [{ find: /^@app/, replacement: path.join(root, "app") }] } }).targets, []);
});

test("aliases cannot disguise local code as a covered Node builtin", (t) => {
  const root = project(t, {
    "source.ts": `import { readFileSync } from "node:fs"; export function entry() { return readFileSync("x"); }`,
    "mock.ts": `export function readFileSync(file: string) { return unknownOperation(file); }`,
  });
  const result = transform(root, "source.ts", { options: { ...defaults, resolveAliases: [{ find: "node:fs", replacement: path.join(root, "mock.ts") }] } });
  assert.deepEqual(result.targets, []);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_CALL"));
});

test("named nested arrows and expressions replay directly with stable module bindings and self recursion", async (t) => {
  const root = project(t, { "source.ts": `
const scale = 4;
export function owner() {
  throw new Error("owner must not execute");
  const arrow = (n: number): number => n > 0 ? arrow(n - 1) + 1 : scale;
  const expression = function recurse(n: number): number { return n > 0 ? recurse(n - 1) + 1 : scale; };
}
` });
  const result = transform(root, "source.ts", { replay: true });
  const module = await load(root, result);
  for (const name of ["owner.arrow", "owner.expression"]) {
    const target = result.targets.find((entry) => entry.locator.namePath.join(".") === name);
    assert.ok(target, name);
    assert.equal(module[target.replayExport](3), 7);
  }
});

test("excluded configuration does not discover installed toolchain packages", (t) => {
  const require = createRequire(import.meta.url);
  const root = project(t, {
    "source.ts": `export function entry(n: number) { return n + Math.random(); }`,
    "vitest.config.ts": `import ts from "typescript"; export default { version: ts.version };`,
    "node_modules/typescript/package.json": '{"name":"typescript","main":"./lib/typescript.js"}',
    "node_modules/typescript/lib/typescript.js": readFileSync(require.resolve("typescript"), "utf8"),
  });
  const options = { ...defaults, capture: { mode: "automatic", include: ["**/*"], exclude: ["**/*.config.*"] } };
  const result = analyzeDevProject(root, options, "node");
  assert.deepEqual(names(result), ["entry"]);
  assert.deepEqual(result.diagnostics, []);
});
