import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";
import {
  evaluateAssumption,
  invokeWithAssumption,
  reviewAssumption,
} from "../../dist/assumptions.js";

const lockfile = {
  lockfileName: "package-lock.json",
  lockfileBytes: '{"name":"analysis-integration","lockfileVersion":3}',
};

function analyze(modules) {
  return analyzeProjectCallGraph({ modules, entryModule: "entry.ts", exportName: "root" });
}

function fingerprintInput(modules, analysis, overrides = {}) {
  return {
    modules,
    reachableModules: analysis.reachableModules,
    unknownEvidence: analysis.findings,
    ...lockfile,
    ...overrides,
  };
}

test("direct known effects cannot be laundered through an assumption", () => {
  const modules = {
    "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { console.log(value); return opaque(value); }',
  };
  const result = analyze(modules);

  assert.equal(result.verdict, "refuted");
  assert.ok(result.findings.some(({ code }) => code === "LOGGING"));
  assert.ok(result.findings.some(({ code }) => code === "PACKAGE_CALL"));
  assert.throws(
    () => reviewAssumption("package call was reviewed", result, fingerprintInput(modules, result)),
    (error) => error?.code === "ASSERTION_CONFLICT",
  );

  const unknownModules = {
    "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { return opaque(value); }',
  };
  const unknown = analyze(unknownModules);
  const assumption = reviewAssumption(
    "opaque numeric operation was reviewed",
    unknown,
    fingerprintInput(unknownModules, unknown),
  );
  const evaluated = evaluateAssumption(result, assumption);
  assert.equal(evaluated.verdict, "refuted");
  assert.equal(evaluated.code, "ASSERTION_CONFLICT");
});

test("excluded callees and reachable module initialization still refute their callers", () => {
  const excluded = analyze({
    "entry.ts": `/** @replaylock exclude reviewed boundary */
function hiddenEffect() { return Math.random(); }
export function root() { return hiddenEffect(); }`,
  });
  assert.equal(excluded.verdict, "refuted");
  assert.equal(excluded.reachableCallables.find(({ name }) => name === "hiddenEffect")?.excluded, true);
  assert.ok(excluded.findings.some(({ code }) => code === "RANDOMNESS"));

  const modules = {
    "entry.ts": 'import "./boot"; import { opaque } from "opaque-package"; export function root(value: number) { return opaque(value); }',
    "boot.ts": "const startedAt = Date.now(); export const started = startedAt;",
  };
  const initialized = analyze(modules);
  assert.equal(initialized.verdict, "refuted");
  assert.ok(initialized.findings.some(({ code, source }) => code === "EFFECTFUL_INITIALIZATION" && source === "boot.ts"));
  assert.throws(
    () => reviewAssumption("package call was reviewed", initialized, fingerprintInput(modules, initialized)),
    (error) => error?.code === "ASSERTION_CONFLICT",
  );
});

test("only exact scope-bound reviewed unknown evidence resolves a package boundary", () => {
  const modules = {
    "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { return opaque(value); }',
  };
  const result = analyze(modules);
  const assumption = reviewAssumption(
    "opaque numeric operation was reviewed",
    result,
    fingerprintInput(modules, result),
  );
  assert.equal(evaluateAssumption(result, assumption).verdict, "likely-safe");

  const other = analyze({
    "entry.ts": 'import { missing } from "./missing"; export function root(value: number) { return missing(value); }',
  });
  const evaluated = evaluateAssumption(other, assumption);
  assert.equal(evaluated.verdict, "unknown");
  assert.equal(evaluated.code, "UNKNOWN_EFFECT");
});

test("every fingerprint dimension becomes stale before target invocation", () => {
  const modules = {
    "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { return opaque(value); }',
  };
  const result = analyze(modules);
  const input = fingerprintInput(modules, result);
  const assumption = reviewAssumption("opaque numeric operation was reviewed", result, input);

  let invocationCount = 0;
  assert.equal(invokeWithAssumption(assumption, input, () => ++invocationCount), 1);

  const changedEvidence = result.findings.map((finding, index) => index === 0
    ? { ...finding, message: `${finding.message} changed` }
    : finding);
  const staleInputs = [
    fingerprintInput({ ...modules, "entry.ts": `${modules["entry.ts"]}\n// source changed` }, result),
    fingerprintInput(modules, result, { lockfileBytes: '{"name":"analysis-integration","lockfileVersion":4}' }),
    fingerprintInput(modules, result, { unknownEvidence: changedEvidence }),
    fingerprintInput(modules, result, { intrinsicCatalogVersion: "catalog-changed" }),
    fingerprintInput(modules, result, { analyzerVersion: "analyzer-changed" }),
  ];

  for (const staleInput of staleInputs) {
    assert.throws(
      () => invokeWithAssumption(assumption, staleInput, () => ++invocationCount),
      /STALE_ASSERTION/,
    );
  }
  assert.equal(invocationCount, 1);
});

test("analysis branch integration marker", () => {
  console.log("analysis branch integration verified");
});
