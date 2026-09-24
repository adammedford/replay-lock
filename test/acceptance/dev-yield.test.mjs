import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { analyzeDevProject } from "../../dist/dev-analysis.js";
import { transformDevSource } from "../../dist/dev-transform.js";
import { configureDevRuntime, replayDevTrace } from "../../dist/dev-runtime.js";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { developmentConditions, resolveDevOptions } from "../../dist/dev-options.js";
import { DEV_CATALOG_VERSION } from "../../dist/dev-catalog.js";
import { blockerReport } from "../../scripts/yield-blockers.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.join(repository, "test/fixtures/yield");
const expectations = JSON.parse(readFileSync(path.join(fixtures, "expectations.json"), "utf8"));
const runtimeImport = new URL("../../dist/dev-runtime.js", import.meta.url).href;
// A Vite host supplies its environments' development conditions.
const options = { ...resolveDevOptions(), resolveConditions: developmentConditions({ environments: { ssr: { resolve: { conditions: defaultServerConditions } }, client: { resolve: { conditions: defaultClientConditions } } } }) };
const realms = ["node", "browser"];
const locator = (value) => `${value.module}#${value.namePath.join(".")}`;

function materialize(t, name) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), `replaylock-yield-${name}-`)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(fixtures, name, "project"), root, { recursive: true });
  if (existsSync(path.join(fixtures, name, "packages"))) cpSync(path.join(fixtures, name, "packages"), path.join(root, "node_modules"), { recursive: true });
  return root;
}
function eligibility(root, environment) {
  const analysis = analyzeDevProject(root, options, environment);
  const codes = new Map();
  for (const diagnostic of analysis.diagnostics) {
    const key = locator(diagnostic.locator);
    codes.set(key, [...(codes.get(key) ?? []), diagnostic.code]);
  }
  return { eligible: analysis.targets.map((target) => locator(target.locator)).sort(), codes };
}
async function completion(invoke) {
  try { return { kind: "return", value: await invoke() }; }
  catch (error) { return { kind: "throw", value: { name: error?.name, message: error?.message } }; }
}
async function withoutNativeEffects(invoke) {
  const saved = { random: Math.random, now: Date.now, fetch: globalThis.fetch, uuid: globalThis.crypto.randomUUID, performance: performance.now };
  const forbidden = () => { throw new Error("NATIVE_EFFECT_DURING_REPLAY"); };
  Math.random = forbidden; Date.now = forbidden; globalThis.fetch = forbidden; globalThis.crypto.randomUUID = forbidden; performance.now = forbidden;
  try { return await invoke(); }
  finally { Math.random = saved.random; Date.now = saved.now; globalThis.fetch = saved.fetch; globalThis.crypto.randomUUID = saved.uuid; performance.now = saved.performance; }
}

test("the yield fixtures describe the current development catalog", () => {
  assert.equal(expectations.schemaVersion, 1);
  assert.equal(expectations.catalogVersion, DEV_CATALOG_VERSION);
});

test("ordinary application code has exactly the recorded eligible set in both realms", (t) => {
  const root = materialize(t, "corpus");
  for (const environment of realms) {
    assert.deepEqual(eligibility(root, environment).eligible, [...expectations.corpus.eligible[environment]].sort(), environment);
  }
});

test("every replay hazard stays ineligible for an expected reason in both realms", (t) => {
  const root = materialize(t, "false-safe");
  for (const environment of realms) {
    const { eligible, codes } = eligibility(root, environment);
    assert.deepEqual(eligible, [...expectations.falseSafe.eligible[environment]].sort(), environment);
    for (const [hazard, expected] of Object.entries(expectations.falseSafe.rejected)) {
      const actual = codes.get(hazard);
      assert.ok(actual, `${environment} ${hazard} was not analyzed`);
      assert.ok(expected.some((code) => actual.includes(code)), `${environment} ${hazard}: expected one of ${expected.join(", ")}, got ${actual.join(", ")}`);
    }
  }
});

async function replaySamples(t, name, section) {
  const root = materialize(t, name);
  t.after(() => configureDevRuntime(undefined));
  const modules = new Map();
  let outputs = 0;
  for (const [sampled, calls] of Object.entries(section.samples)) {
    assert.ok(section.eligible.node.includes(sampled), `${sampled} is not eligible`);
    const [module, callable] = sampled.split("#");
    if (!modules.has(module)) {
      const id = path.join(root, module);
      const transformed = transformDevSource({ root, id, code: readFileSync(id, "utf8"), environment: "node", generation: "yield", options, runtimeImport, replay: true });
      const compiled = ts.transpileModule(transformed.code, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } });
      const file = path.join(root, ".output", `module-${outputs++}.mjs`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, compiled.outputText);
      modules.set(module, { exports: await import(pathToFileURL(file).href), targets: transformed.targets });
    }
    const { exports, targets } = modules.get(module);
    const target = targets.find((item) => locator(item.locator) === sampled);
    assert.ok(target, `${sampled} was not transformed as a target`);
    for (const args of calls) {
      const observations = [], blocks = [];
      configureDevRuntime({ onObservation: (value) => observations.push(value), onBlock: (value) => blocks.push(value) });
      const live = await completion(() => exports[callable](...structuredClone(args)));
      configureDevRuntime(undefined);
      assert.deepEqual(blocks, [], `${sampled} blocked ${JSON.stringify(args)}`);
      const observation = observations.find((item) => locator(item.locator) === sampled);
      assert.ok(observation, `${sampled} ${JSON.stringify(args)} was not observed`);
      const replayed = await withoutNativeEffects(() => completion(() => replayDevTrace(observation.trace, () => exports[target.replayExport](...structuredClone(args)))));
      assert.deepEqual(replayed, live, `${sampled} ${JSON.stringify(args)}`);
    }
  }
}

test("eligible corpus samples replay offline to their live completion", (t) => replaySamples(t, "corpus", expectations.corpus));

test("effects inside callbacks are intercepted: hazards made eligible replay offline", (t) => replaySamples(t, "false-safe", expectations.falseSafe));

test("this repository's own code meets its eligibility floor", () => {
  for (const environment of realms) {
    const eligible = analyzeDevProject(repository, options, environment).targets.length;
    assert.ok(eligible >= expectations.selfFloor[environment], `${environment}: ${eligible} eligible is below the floor of ${expectations.selfFloor[environment]}`);
  }
});

test("the blocker report excludes only unsupported constructs from the unlock plan", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "replaylock-yield-shapes-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "shapes", type: "module" }));
  writeFileSync(path.join(root, "src/shapes.tsx"), [
    "export function badge(label: string) { return <span>{label}</span>; }",
    "export function boxed(value: number) { class Box { constructor(readonly value: number) {} } return new Box(value).value; }",
    "export function* counted(limit: number) { yield limit; }",
    "export function first() { return arguments[0]; }",
    "export const raw = (value: string) => String.raw`${value}`;",
    "export function doubled(items: number[]) { return items.map((item) => { function twice(value: number) { return value * 2; } return twice(item); }); }",
    "export async function awaited(load: () => Promise<number>) { return await load(); }",
    "const fallback = 'none';",
    "export function defaulted(value = fallback) { return value; }",
    "export var legacy = (value: number) => value + 1;",
    "",
  ].join("\n"));
  for (const environment of realms) {
    const report = blockerReport(analyzeDevProject(root, options, environment), root);
    const item = (name) => report.callables.find((entry) => entry.callable === `src/shapes.tsx#${name}`);
    const shape = (name, code) => item(name)?.blockers.find((blocker) => blocker.code === code)?.shape;
    for (const [name, construct] of [["badge", "jsx"], ["boxed", "class"], ["counted", "generator"], ["first", "arguments"], ["raw", "tagged-template"], ["doubled.<anonymous>.twice", "nested"]]) {
      assert.equal(shape(name, "UNSUPPORTED_CALLABLE"), construct, `${environment}: ${name}`);
      assert.equal(item(name).category, "outside-shapes", `${environment}: ${name}`);
      assert.ok(report.outsideShapeKinds[construct] >= 1, `${environment}: ${construct}`);
    }
    // An await on an unanalyzed call, a non-literal default and a non-const binding are fixable blockers.
    for (const [name, code, construct] of [["awaited", "UNSUPPORTED_ASYNC", "await"], ["defaulted", "UNSUPPORTED_CALLABLE", "parameter-default"], ["legacy", "UNSUPPORTED_CALLABLE", "binding"]]) {
      assert.equal(shape(name, code), construct, `${environment}: ${name}`);
      assert.notEqual(item(name).category, "outside-shapes", `${environment}: ${name}`);
    }
    assert.equal(Object.values(report.outsideShapeKinds).some((count) => count > report.outsideShapes), false);
  }
});

test("the blocker report traces skipped callables to their root sites", (t) => {
  const root = materialize(t, "false-safe");
  for (const environment of realms) {
    const analysis = analyzeDevProject(root, options, environment);
    const report = blockerReport(analysis, root, { top: 10 });
    const eligible = new Set(analysis.targets.map((target) => locator(target.locator)));
    assert.equal(report.eligible, eligible.size);
    assert.ok(report.callables.every((item) => !eligible.has(item.callable)), "an eligible callable is reported as skipped");
    assert.equal(report.outsideShapes + report.ownBody + report.inheritedOnly, report.skipped);
    // A module-scope prototype write reaches its importer through initialization.
    const patched = report.callables.find((item) => item.callable === "src/init/uses-patcher.ts#patchedImport");
    assert.deepEqual(patched.blockers, [{ code: "EFFECTFUL_INITIALIZATION", site: "src/init/patcher.ts:1", inherited: true }]);
    for (const [hazard, codes] of Object.entries(expectations.falseSafe.rejected)) {
      if (!/^src\/init\/uses-/.test(hazard) || !codes.includes("EFFECTFUL_INITIALIZATION")) continue;
      const item = report.callables.find((entry) => entry.callable === hazard);
      assert.ok(item.blockers.some((blocker) => blocker.code === "EFFECTFUL_INITIALIZATION" && blocker.inherited), hazard);
    }
    // A site's only-blocker count is exactly what resolving it alone unlocks.
    const inScope = report.callables.filter((item) => item.category !== "outside-shapes");
    for (const row of report.sites) {
      const alone = inScope.filter((item) => item.blockers.length === 1 && item.blockers[0].code === row.code && item.blockers[0].site === row.site).length;
      assert.equal(row.only, alone, `${row.code} @ ${row.site}`);
    }
    let previous = 0;
    for (const step of report.plan) {
      assert.equal(step.cumulative, previous + step.unlocked.length);
      previous = step.cumulative;
    }
    assert.ok(previous <= inScope.length);
    assert.deepEqual(report.nearMisses.map((miss) => miss.callable), inScope.filter((item) => item.blockers.length <= 2).map((item) => item.callable));
  }
});
