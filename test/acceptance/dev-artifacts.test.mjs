import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createDevCandidate, createDevCaseId, devArtifactJson, parseDevCase, parseDevCandidate, persistDevObservations, toDevCase } from "../../dist/dev-artifacts.js";
import { preflightDevCases, validateDevCaseAdapters } from "../../dist/dev-verify.js";
import { encodeDevValue } from "../../dist/dev-values.js";
import { configureDevRuntime, runtimeProfile } from "../../dist/dev-runtime.js";
import { transformDevSource } from "../../dist/dev-transform.js";
import { resolveDevOptions } from "../../dist/dev-options.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactsUrl = pathToFileURL(path.join(root, "dist/dev-artifacts.js")).href;
const verifyUrl = pathToFileURL(path.join(root, "dist/dev-verify.js")).href;
const digest = `sha256:${"a".repeat(64)}`;
const profiles = { node: runtimeProfile("node"), browser: { environment: "browser", runtime: "browser:chromium", timezone: "UTC", locale: "en-US" } };
const options = resolveDevOptions({ effects: { environment: ["REPLAYLOCK_TEST_VALUE"] } });
function observation(overrides = {}) {
  return { locator: { module: "src/target.mjs", kind: "export", namePath: ["target"] }, environment: "node", generation: "0001", sourceGraphDigest: digest,
    arguments: encodeDevValue([2]), trace: [{ kind: "call", id: 0, operation: "Math.random", arguments: encodeDevValue([]) }, { kind: "return", id: 0, value: encodeDevValue(0.25) }],
    completion: { kind: "return", value: encodeDevValue(2.25) }, ...overrides };
}
function candidate(overrides = {}) { const obs = observation(overrides); return createDevCandidate(obs, digest, profiles[obs.environment]); }
async function fixture(t, source = "export function target(value) { return value + Math.random(); }\n") {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-dev-artifacts-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, "src"));
  await writeFile(path.join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await writeFile(path.join(project, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  await writeFile(path.join(project, "src/target.mjs"), source);
  await mkdir(path.join(project, "node_modules"));
  await symlink(root, path.join(project, "node_modules/replaylock"), "dir");
  return project;
}
async function files(project, relative) {
  const directory = path.join(project, relative);
  try { return await Promise.all((await readdir(directory)).filter(name => name.endsWith(".json")).sort().map(async name => ({ name, text: await readFile(path.join(directory, name), "utf8") }))); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
const pendingFiles = project => files(project, ".replaylock/observations/pending-v2");
const acceptedFiles = project => files(project, ".replaylock/cases");
async function writeCases(project, cases, pending = false) {
  const directory = path.join(project, pending ? ".replaylock/observations/pending-v2" : ".replaylock/cases");
  await mkdir(directory, { recursive: true });
  for (const item of cases) await writeFile(path.join(directory, `${item.caseId}.json`), devArtifactJson(item));
}
function runReview(project, input, shared = false) {
  const code = shared
    ? `import {reviewDevCandidates} from ${JSON.stringify(artifactsUrl)}; const lines = ${JSON.stringify(input.trimEnd().split("\n"))}; const iterator = (async function*(){yield* lines;})(); process.exitCode = await reviewDevCandidates(${JSON.stringify(project)},iterator); console.log('UNCONSUMED', (await iterator.next()).value);`
    : `import {reviewDevCandidates} from ${JSON.stringify(artifactsUrl)}; process.exitCode = await reviewDevCandidates(${JSON.stringify(project)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: project, encoding: "utf8", input, timeout: 20_000 });
}
function runVerify(project, cases, replayOptions = options) {
  const code = `import {verifyDevCases} from ${JSON.stringify(verifyUrl)}; process.exitCode = await verifyDevCases(${JSON.stringify(project)},${JSON.stringify(cases)},${JSON.stringify(replayOptions)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: project, encoding: "utf8", timeout: 60_000 });
}
const output = result => `${result.stdout ?? ""}${result.stderr ?? ""}`;

test("V2 identity includes locator, arguments, correlated trace and environment; output and provenance are excluded", () => {
  const first = candidate();
  assert.equal(first.caseId, candidate({ completion: { kind: "return", value: encodeDevValue(99) }, sourceGraphDigest: `sha256:${"b".repeat(64)}`, generation: "0002" }).caseId);
  assert.notEqual(first.caseId, candidate({ environment: "browser" }).caseId);
  assert.notEqual(first.caseId, candidate({ trace: [] }).caseId);
  assert.notEqual(first.caseId, candidate({ arguments: encodeDevValue([3]) }).caseId);
  assert.notEqual(first.caseId, candidate({ locator: { ...first.locator, kind: "local" } }).caseId);
  const reverseKeys = value => value && typeof value === "object" ? Array.isArray(value) ? value.map(reverseKeys) : Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  assert.equal(createDevCaseId({ trace: first.trace, arguments: first.arguments, environment: first.environment, locator: first.locator }), first.caseId);
  assert.deepEqual(parseDevCase(devArtifactJson(toDevCase(first))), toDevCase(first));
  assert.deepEqual(parseDevCandidate(devArtifactJson(first)), first);
  assert.deepEqual(parseDevCase(JSON.stringify(reverseKeys(toDevCase(first)))), toDevCase(first));
});

test("strict schema rejects unknown fields, forged IDs, malformed traces, paths and profiles", () => {
  const base = toDevCase(candidate());
  for (const mutate of [
    value => { value.extra = true; },
    value => { value.schemaVersion = 1; },
    value => { value.caseId = "b".repeat(64); },
    value => { value.locator.module = "../outside.mjs"; },
    value => { value.locator.module = "src\\target.mjs"; },
    value => { value.arguments = encodeDevValue(1); },
    value => { value.trace.pop(); },
    value => { value.trace[0].id = 2; value.trace[1].id = 2; },
    value => { value.trace[0].operation = "unknown"; },
    value => { value.trace.push(value.trace[1]); },
    value => { value.trace[0].extra = 1; },
    value => { value.completion.kind = "yield"; },
    value => { value.comparison = { kind: "tolerance", epsilon: 0 }; },
    value => { value.provenance.runtimeProfile.environment = "browser"; },
    value => { value.provenance.runtimeProfile.timezone = "made/up"; },
    value => { value.provenance.lockfileDigest = "abc"; },
    value => { value.provenance.captureStatus = "unfinished"; },
    value => { value.eligibility.reasonCodes = ["OK", "OK"]; },
  ]) { const changed = structuredClone(base); mutate(changed); assert.throws(() => parseDevCase(JSON.stringify(changed))); }
  assert.throws(() => parseDevCase(devArtifactJson(candidate())), /CASE_SCHEMA_UNSUPPORTED/);
  assert.throws(() => parseDevCandidate(devArtifactJson({ ...candidate(), occurrences: 0 })));
  assert.throws(() => parseDevCandidate(devArtifactJson({ ...candidate(), replacesCaseId: "b".repeat(64) })));
});

test("privacy validation covers input, result, trace, binary and metadata before persistence", async t => {
  const project = await fixture(t);
  const sensitive = { kind: "record", entries: [{ key: "password", value: { kind: "string", value: "seeded-value" } }] };
  const binary = { kind: "bytes", type: "Uint8Array", value: Buffer.from("password=seeded-value").toString("base64") };
  const invalid = [
    observation({ arguments: { kind: "array", items: [sensitive] } }),
    observation({ completion: { kind: "return", value: sensitive } }),
    observation({ trace: [{ kind: "call", id: 0, operation: "Math.random", arguments: encodeDevValue([]) }, { kind: "return", id: 0, value: binary }] }),
    observation({ sourceGraphDigest: "password=seeded-value" }),
    observation({ completion: { kind: "return", value: { kind: "string", value: "x".repeat(256 * 1024) } } }),
  ];
  const result = await persistDevObservations(project, invalid, digest, profiles);
  assert.equal(result.blocked, invalid.length);
  assert.equal(result.candidates, 0);
  assert.deepEqual(await pendingFiles(project), []);
  assert.doesNotMatch(JSON.stringify(result), /seeded-value/);
});

test("dedup counts repeats, separates recorded randomness and blocks conflicting output in one generation", async t => {
  const project = await fixture(t);
  const otherRandom = structuredClone(observation()); otherRandom.trace[1].value = encodeDevValue(0.5); otherRandom.completion.value = encodeDevValue(2.5);
  let result = await persistDevObservations(project, [observation(), observation(), otherRandom], digest, profiles);
  assert.equal(result.candidates, 2); assert.equal(result.duplicates, 1);
  assert.deepEqual((await pendingFiles(project)).map(item => parseDevCandidate(item.text).occurrences).sort(), [1, 2]);
  result = await persistDevObservations(project, [observation(), observation({ completion: { kind: "return", value: encodeDevValue(8) } })], digest, profiles);
  assert.equal(result.candidates, 0); assert.equal(result.blocks[0].code, "OBSERVED_NONDETERMINISM");
  assert.equal((await pendingFiles(project)).length, 1, "unrelated recorded randomness remains pending");
  assert.equal(parseDevCandidate((await pendingFiles(project))[0].text).caseId, createDevCandidate(otherRandom, digest, profiles.node).caseId);
});

test("latest complete generation wins per extended input and retains unrelated pending inputs", async t => {
  const project = await fixture(t);
  const old = observation();
  const latest = observation({ generation: "0002", completion: { kind: "return", value: encodeDevValue(5.25) } });
  const otherInput = observation({ arguments: encodeDevValue([99]) });
  const unfinished = observation({ generation: "0003", completion: { kind: "return", value: encodeDevValue(123) } });
  await persistDevObservations(project, [old, otherInput], digest, profiles);
  const result = await persistDevObservations(project, [latest, old, unfinished], digest, profiles, { completedGenerations: ["0001", "0002"] });
  assert.equal(result.candidates, 1);
  const stored = (await pendingFiles(project)).map(item => parseDevCandidate(item.text));
  assert.equal(stored.length, 2);
  const updated = stored.find(item => item.caseId === candidate().caseId);
  assert.deepEqual(updated.completion, latest.completion);
  assert.equal(updated.provenance.captureStatus, "complete");
});

test("accepted shared cases survive capture; same behavior is suppressed and changed output is an explicit replacement", async t => {
  const project = await fixture(t);
  await writeCases(project, [toDevCase(candidate())]);
  const legacyPath = path.join(project, ".replaylock/cases/legacy.json");
  await writeFile(legacyPath, '{"schemaVersion":1,"legacy":"untouched"}\n');
  const before = await acceptedFiles(project);
  let result = await persistDevObservations(project, [observation()], digest, profiles);
  assert.equal(result.candidates, 0);
  result = await persistDevObservations(project, [observation({ completion: { kind: "return", value: encodeDevValue(42) } })], digest, profiles);
  assert.equal(result.candidates, 1);
  assert.equal(parseDevCandidate((await pendingFiles(project))[0].text).replacesCaseId, candidate().caseId);
  assert.deepEqual(await acceptedFiles(project), before);
});

test("human review supports exact, tolerance, per-file batches and a shared iterator", async t => {
  const project = await fixture(t);
  const a = candidate({ locator: { module: "src/target.mjs", kind: "export", namePath: ["a"] } });
  const b = candidate({ locator: { module: "src/target.mjs", kind: "export", namePath: ["b"] } });
  const c = candidate({ locator: { module: "src/z.mjs", kind: "export", namePath: ["c"] } });
  await writeCases(project, [a, b, c], true);
  const result = runReview(project, "af\nt\n0.01\nnext-reader\n", true);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /UNCONSUMED next-reader/);
  const accepted = (await acceptedFiles(project)).map(item => parseDevCase(item.text));
  assert.equal(accepted.length, 3);
  assert.deepEqual(accepted.find(item => item.caseId === c.caseId).comparison, { kind: "tolerance", epsilon: 0.01 });
  assert.equal(accepted.find(item => item.caseId === a.caseId).comparison, "exact");
  assert.deepEqual(await pendingFiles(project), []);
});

test("review replacements require explicit confirmation, including during a file batch", async t => {
  const project = await fixture(t);
  const original = candidate({ locator: { module: "src/target.mjs", kind: "export", namePath: ["b"] } });
  const replacement = { ...original, completion: { kind: "return", value: encodeDevValue(42) }, replacesCaseId: original.caseId };
  await writeCases(project, [toDevCase(original)]);
  const before = await acceptedFiles(project);
  await writeCases(project, [candidate({ locator: { ...original.locator, namePath: ["a"] } }), replacement], true);
  const unconfirmed = runReview(project, "af\na\n");
  assert.equal(unconfirmed.status, 2, output(unconfirmed));
  assert.match(output(unconfirmed), /Replacement diff/);
  assert.equal((await acceptedFiles(project)).find(item => item.name === before[0].name).text, before[0].text);
  const confirmed = runReview(project, "a\nreplace\n");
  assert.equal(confirmed.status, 0, output(confirmed));
  assert.deepEqual(parseDevCase((await acceptedFiles(project)).find(item => item.name === before[0].name).text).completion, replacement.completion);
});

test("invalid tolerance, skip and reject never accidentally accept a candidate", async t => {
  const project = await fixture(t);
  await writeCases(project, [candidate()], true);
  assert.equal(runReview(project, "t\n0\n").status, 2);
  assert.equal((await pendingFiles(project)).length, 1);
  assert.equal(runReview(project, "s\n").status, 0);
  assert.equal((await pendingFiles(project)).length, 1);
  assert.equal(runReview(project, "r\n").status, 0);
  assert.deepEqual(await pendingFiles(project), []); assert.deepEqual(await acceptedFiles(project), []);
});

test("preflight resolves real paths and rechecks every callable before project execution", async t => {
  const project = await fixture(t);
  const valid = toDevCase(candidate());
  await preflightDevCases(project, [valid], options);
  const missing = toDevCase(candidate({ locator: { ...valid.locator, namePath: ["missing"] } }));
  await assert.rejects(preflightDevCases(project, [valid, missing], options), /ORPHANED_CALLABLE/);
  const external = await fixture(t);
  await symlink(path.join(external, "src/target.mjs"), path.join(project, "src/escape.mjs"));
  const escape = toDevCase(candidate({ locator: { ...valid.locator, module: "src/escape.mjs" } }));
  await assert.rejects(preflightDevCases(project, [valid, escape], options), /ORPHANED_CALLABLE/);
  const marker = path.join(project, "was-executed");
  await writeFile(path.join(project, "src/target.mjs"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad'); export function target(value) {return value + Math.random();}`);
  await assert.rejects(preflightDevCases(project, [valid], options), /REPLAY_SAFETY_REGRESSION/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("isolated Node replay is offline and detects output and trace regressions", async t => {
  const project = await fixture(t, `import { readFileSync } from 'node:fs';
export function target(filename) { return { text: readFileSync(filename, 'utf8'), value: process.env.REPLAYLOCK_TEST_VALUE, random: Math.random(), now: Date.now() }; }
`);
  const data = path.join(project, "data.txt"); await writeFile(data, "recorded file");
  const previous = process.env.REPLAYLOCK_TEST_VALUE; process.env.REPLAYLOCK_TEST_VALUE = "recorded env";
  const captures = [], blocks = [];
  configureDevRuntime({ onObservation: entry => captures.push(entry), onBlock: entry => blocks.push(entry) });
  try {
    const source = await readFile(path.join(project, "src/target.mjs"), "utf8");
    const transformed = transformDevSource({ root: project, id: path.join(project, "src/target.mjs"), code: source, environment: "node", generation: "0001", options, runtimeImport: pathToFileURL(path.join(root, "dist/dev-runtime.js")).href });
    assert.equal(transformed.targets.length, 1, JSON.stringify(transformed.diagnostics));
    const module = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`);
    module.target(data);
  } finally { configureDevRuntime(undefined); if (previous === undefined) delete process.env.REPLAYLOCK_TEST_VALUE; else process.env.REPLAYLOCK_TEST_VALUE = previous; }
  assert.deepEqual(blocks, []); assert.equal(captures.length, 1);
  const artifact = toDevCase(createDevCandidate(captures[0], digest, profiles.node));
  await rm(data); // A native filesystem read would now throw.
  const verified = runVerify(project, [artifact]);
  assert.equal(verified.status, 0, output(verified));
  const sourcePath = path.join(project, "src/target.mjs");
  const source = await readFile(sourcePath, "utf8");
  await writeFile(sourcePath, source.replace("now: Date.now()", "now: Date.now() + 1"));
  const outputDrift = runVerify(project, [artifact]);
  assert.equal(outputDrift.status, 1, output(outputDrift));
  await writeFile(sourcePath, source.replace("random: Math.random()", "random: Date.now()"));
  const traceDrift = runVerify(project, [artifact]);
  assert.equal(traceDrift.status, 1, output(traceDrift));
  assert.deepEqual(await readdir(path.join(project, ".replaylock/verify")), []);
});

test("isolated replay respects tolerance and throw completions, and invokes private and stateless nested handles", async t => {
  const project = await fixture(t, `function privateTarget(value) { return value + 0.005; }
export function owner() { function nested(value) { if (value < 0) throw new RangeError('negative'); return value + 1; } throw new Error('owner must not run'); }
`);
  const local = toDevCase(candidate({ locator: { module: "src/target.mjs", kind: "local", namePath: ["privateTarget"] }, trace: [], completion: { kind: "return", value: encodeDevValue(2) } }));
  local.comparison = { kind: "tolerance", epsilon: 0.01 };
  const nested = toDevCase(candidate({ locator: { module: "src/target.mjs", kind: "nested", namePath: ["owner", "nested"] }, trace: [], arguments: encodeDevValue([-1]), completion: { kind: "throw", value: encodeDevValue(new RangeError("negative")) } }));
  const verified = runVerify(project, [local, nested]);
  assert.equal(verified.status, 0, output(verified));
  local.comparison = "exact";
  const exact = runVerify(project, [local]); assert.equal(exact.status, 1, output(exact));
});

test("browser replay uses Chromium in a separate realm", async t => {
  const project = await fixture(t, `export function target(value) { return value + Math.random(); }`);
  const artifact = toDevCase(candidate({ environment: "browser" }));
  const result = runVerify(project, [artifact]);
  assert.equal(result.status, 0, output(result));
});

test("per-observation runtime profiles retain provenance without hiding same-generation conflicts", async t => {
  const project = await fixture(t);
  const french = { ...profiles.browser, locale: "fr-FR" };
  const first = observation({ environment: "browser" });
  const second = observation({ environment: "browser", arguments: encodeDevValue([3]) });
  const result = await persistDevObservations(project, [first, second], digest, profiles, { observationProfiles: [profiles.browser, french] });
  assert.equal(result.candidates, 2);
  const stored = (await pendingFiles(project)).map(entry => parseDevCandidate(entry.text));
  assert.equal(stored.find(entry => entry.arguments.items[0].value === 3).provenance.runtimeProfile.locale, "fr-FR");
  const conflict = await persistDevObservations(project, [first, { ...first, completion: { kind: "return", value: encodeDevValue(99) } }], digest, profiles, { observationProfiles: [profiles.browser, french] });
  assert.equal(conflict.blocks[0].code, "OBSERVED_NONDETERMINISM");
  assert.equal((await pendingFiles(project)).length, 1);
});

test("project limits include legacy cases and candidate persistence never produces unreadable oversized JSON", async t => {
  const project = await fixture(t);
  const directory = path.join(project, ".replaylock/cases"); await mkdir(directory, { recursive: true });
  await Promise.all(Array.from({ length: 1000 }, (_, index) => writeFile(path.join(directory, `legacy-${index}.json`), '{"schemaVersion":1}')));
  const result = await persistDevObservations(project, [observation()], digest, profiles);
  assert.equal(result.blocks[0].code, "PROJECT_LIMIT"); assert.deepEqual(await pendingFiles(project), []);
  const large = observation({ arguments: encodeDevValue(Array.from({ length: 7000 }, (_, index) => index)) });
  assert.throws(() => createDevCandidate(large, digest, profiles.node), /OVERSIZED_OBSERVATION/);
});

test("schema boundaries reject accessors and proxies without invoking them", () => {
  let reads = 0;
  const source = observation();
  Object.defineProperty(source, "completion", { enumerable: true, get() { reads++; return { kind: "return", value: encodeDevValue(1) }; } });
  assert.throws(() => createDevCandidate(source, digest, profiles.node));
  assert.equal(reads, 0);
  assert.throws(() => createDevCandidate(new Proxy(observation(), { get() { reads++; throw new Error("trap"); } }), digest, profiles.node));
  assert.equal(reads, 0);
});

test("browser adapters load and roundtrip in the browser realm before callable execution", async t => {
  const project = await fixture(t, `export function target(value) { return value; }`);
  await writeFile(path.join(project, "src/amount.mjs"), `export class Amount { constructor(value) { this.value = value; } }`);
  const config = `import { defineReplayLock, defineValueAdapter } from 'replaylock';
import { Amount } from './src/amount.mjs';
export default defineReplayLock({ valueAdapters: [defineValueAdapter({ id: 'amount', version: 1, type: Amount,
  serialize(value) { if (!(value instanceof Amount)) throw new Error('wrong realm'); return value.value; },
  deserialize(value) { return new Amount(value); }
})] });`;
  await writeFile(path.join(project, "replaylock.config.mjs"), config);
  const adapted = { kind: "adapted", adapterId: "amount", version: 1, payload: encodeDevValue(7) };
  const artifact = toDevCase(candidate({ environment: "browser", trace: [], arguments: { kind: "array", items: [adapted] }, completion: { kind: "return", value: adapted } }));
  const verified = runVerify(project, [artifact]); assert.equal(verified.status, 0, output(verified));
  await writeFile(path.join(project, "replaylock.config.mjs"), config.replace("new Amount(value)", "new Amount(value + 1)"));
  const invalid = runVerify(project, [artifact]); assert.equal(invalid.status, 2, output(invalid));
  assert.match(output(invalid), /VALUE_ADAPTER_ROUND_TRIP_MISMATCH/);
});

test("Vite aliases and custom transforms survive replay while live capture plugins stay disabled", async t => {
  const project = await fixture(t, `import { offset } from '@source/offset.mjs'; export function target(value) { return value + offset; }`);
  await writeFile(path.join(project, "src/offset.mjs"), `export const offset = 1;`);
  await writeFile(path.join(project, "vite.config.mjs"), `export default {
    resolve: { alias: { '@source': ${JSON.stringify(path.join(project, "src"))} } },
    plugins: [
      { name: 'replaylock:dev', config() { throw new Error('capture plugin must not run'); } },
      { name: 'fixture-transform', enforce: 'post', transform(code,id) { if (id.endsWith('/offset.mjs')) return code.replace('offset = 1', 'offset = 2'); } }
    ]
  };`);
  const aliasOptions = { ...options, resolveAliases: [{ find: "@source", replacement: path.join(project, "src") }] };
  const artifact = toDevCase(candidate({ trace: [], completion: { kind: "return", value: encodeDevValue(4) } }));
  const verified = runVerify(project, [artifact], aliasOptions); assert.equal(verified.status, 0, output(verified));
});

test("each accepted case starts with fresh module state", async t => {
  const project = await fixture(t, `export function target(value) { return value; }`);
  await writeFile(path.join(project, "vite.config.mjs"), `export default { plugins: [{ name: 'isolation-probe', enforce: 'post', transform(code,id) {
    if (id.endsWith('/src/target.mjs')) return 'let replayInvocation = 0;\\n' + code.replace('return value;', 'return value + replayInvocation++;');
  }}] };`);
  const first = toDevCase(candidate({ trace: [], completion: { kind: "return", value: encodeDevValue(2) } }));
  const second = toDevCase(candidate({ trace: [], arguments: encodeDevValue([3]), completion: { kind: "return", value: encodeDevValue(3) } }));
  const verified = runVerify(project, [first, second]); assert.equal(verified.status, 0, output(verified));
});

test("caught effect mismatches remain behavioral failures with the public diagnostic", async t => {
  const project = await fixture(t, `export function target(value) { try { return value + Date.now(); } catch { return -1; } }`);
  const artifact = toDevCase(candidate({ completion: { kind: "return", value: encodeDevValue(-1) } }));
  const result = runVerify(project, [artifact]);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /EFFECT_TRACE_MISMATCH/);
});

test("all V2 adapter profiles validate before an earlier callable can execute", async t => {
  const project = await fixture(t, `export function target(value) { return value; }`);
  const marker = path.join(project, "target-invoked.txt");
  const injected = `import {writeFileSync as probeWrite} from 'node:fs';\n`;
  const body = `probeWrite(${JSON.stringify(marker)}, 'invoked'); return value;`;
  await writeFile(path.join(project, "vite.config.mjs"), `export default { plugins: [{ name: 'invocation-probe', enforce: 'post', transform(code,id) {
    if (id.endsWith('/src/target.mjs')) return ${JSON.stringify(injected)} + code.replace('return value;', ${JSON.stringify(body)});
  }}] };`);
  const first = toDevCase(candidate({ trace: [], completion: { kind: "return", value: encodeDevValue(2) } }));
  const control = runVerify(project, [first]);
  assert.equal(control.status, 0, output(control));
  assert.equal(await readFile(marker, "utf8"), "invoked", "positive control proves the callable execution probe fires");
  await rm(marker);
  const adapted = { kind: "adapted", adapterId: "missing", version: 1, payload: encodeDevValue(7) };
  const later = toDevCase(candidate({ environment: "browser", trace: [], arguments: { kind: "array", items: [adapted] }, completion: { kind: "return", value: adapted } }));
  const validation = await validateDevCaseAdapters(project, [first, later], options);
  assert.equal(validation, 2);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  const blocked = runVerify(project, [first, later]);
  assert.equal(blocked.status, 2, output(blocked));
  assert.match(output(blocked), /VALUE_ADAPTER_MISSING/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.deepEqual(await readdir(path.join(project, ".replaylock/verify")), []);
});
