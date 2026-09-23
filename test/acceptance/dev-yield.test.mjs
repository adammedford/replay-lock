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

test("eligible corpus samples replay offline to their live completion", async (t) => {
  const root = materialize(t, "corpus");
  t.after(() => configureDevRuntime(undefined));
  const modules = new Map();
  let outputs = 0;
  for (const [sampled, calls] of Object.entries(expectations.corpus.samples)) {
    assert.ok(expectations.corpus.eligible.node.includes(sampled), `${sampled} is not an eligible corpus function`);
    const [module, name] = sampled.split("#");
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
      const live = await completion(() => exports[name](...structuredClone(args)));
      configureDevRuntime(undefined);
      assert.deepEqual(blocks, [], `${sampled} blocked ${JSON.stringify(args)}`);
      assert.equal(observations.length, 1, `${sampled} ${JSON.stringify(args)}`);
      const replayed = await withoutNativeEffects(() => completion(() => replayDevTrace(observations[0].trace, () => exports[target.replayExport](...structuredClone(args)))));
      assert.deepEqual(replayed, live, `${sampled} ${JSON.stringify(args)}`);
    }
  }
});

test("this repository's own code meets its eligibility floor", () => {
  for (const environment of realms) {
    const eligible = analyzeDevProject(repository, options, environment).targets.length;
    assert.ok(eligible >= expectations.selfFloor[environment], `${environment}: ${eligible} eligible is below the floor of ${expectations.selfFloor[environment]}`);
  }
});
