import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";
import ts from "typescript";
import {
  isTypeScriptSourceFilename,
  typescriptScriptKind,
} from "../../dist/typescript-script-kind.js";

const analyze = (modules, exportName = "root", entryModule = "entry.ts") =>
  analyzeProjectCallGraph({ modules, entryModule, exportName });

test("all analyzers select script kinds with the locked Vite extension policy", () => {
  assert.equal(typescriptScriptKind("entry.tsx"), ts.ScriptKind.TSX);
  assert.equal(typescriptScriptKind("entry.jsx"), ts.ScriptKind.JSX);
  assert.equal(typescriptScriptKind("entry.mjs"), ts.ScriptKind.JS);
  assert.equal(typescriptScriptKind("entry.cjs"), ts.ScriptKind.JS);
  assert.equal(typescriptScriptKind("entry.cts"), ts.ScriptKind.TS);
  assert.equal(isTypeScriptSourceFilename("entry.ts"), true);
  assert.equal(isTypeScriptSourceFilename("entry.mjs"), true);
  assert.equal(isTypeScriptSourceFilename("entry.TS"), false);
  assert.equal(isTypeScriptSourceFilename("entry.md"), false);
});

test("identifier calls and named local imports are followed transitively", () => {
  const result = analyze({
    "entry.ts": 'import { twice } from "./helper"; export function root(value: number) { return twice(value); }',
    "helper.ts": "import { leaf } from './leaf'; export function twice(value: number) { return leaf(value) * 2; }",
    "leaf.ts": "export function leaf(value: number) { return Math.trunc(value); }",
  });
  assert.equal(result.verdict, "likely-safe");
  assert.deepEqual(result.reachableModules, ["entry.ts", "helper.ts", "leaf.ts"]);
  assert.equal(result.reachableCallables.length, 3);
  console.log("transitive local calls verified");
});

test("recursive local call groups converge on a consistent verdict", () => {
  const safe = analyze({
    "entry.ts": "export function root(value: number) { return even(value); } function even(value: number): number { return value <= 0 ? 1 : odd(value - 1); } function odd(value: number): number { return value <= 0 ? 0 : even(value - 1); }",
  });
  assert.equal(safe.verdict, "likely-safe");
  const refuted = analyze({
    "entry.ts": "export function root(value: number) { return first(value); } function first(value: number): number { return value <= 0 ? 1 : second(value - 1); } function second(value: number): number { if (value < 0) return Math.random(); return first(value - 1); }",
  });
  assert.equal(refuted.verdict, "refuted");
  assert.ok(refuted.findings.some(({ code }) => code === "RANDOMNESS"));
  console.log("recursive verdicts verified");
});

test("initialization of every reachable project-local module participates", () => {
  const result = analyze({
    "entry.ts": 'import "./boot"; export function root(value: number) { return value; }',
    "boot.ts": "const started = Date.now(); export const marker = started;",
  });
  assert.equal(result.verdict, "refuted");
  assert.deepEqual(result.reachableModules, ["boot.ts", "entry.ts"]);
  assert.ok(result.findings.some(({ code, source }) => code === "EFFECTFUL_INITIALIZATION" && source === "boot.ts"));
  console.log("module initialization verified");
});

test("a unique local instance method and getter are followed", () => {
  const result = analyze({
    "entry.ts": "class Calculator { get one() { return 1; } add(value: number) { return value + 1; } } export function root(value: number) { const calculator = new Calculator(); return calculator.add(value) + calculator.one; }",
  });
  assert.equal(result.verdict, "likely-safe");
  assert.ok(result.reachableCallables.some(({ name }) => name === "Calculator.add"));
  assert.ok(result.reachableCallables.some(({ name }) => name === "Calculator.one"));

  const imported = analyze({
    "entry.ts": 'import { ImportedCalculator } from "./calculator"; export function root(value: number) { const calculator = new ImportedCalculator(); return calculator.add(value); }',
    "calculator.ts": "export class ImportedCalculator { add(value: number) { return value + 1; } }",
  });
  assert.equal(imported.verdict, "likely-safe");
  assert.ok(imported.reachableCallables.some(({ name }) => name === "ImportedCalculator.add"));

  const safeConstructor = analyze({
    "entry.ts": "class Safe { constructor() {} } export function root() { new Safe(); return 1; }",
  });
  assert.equal(safeConstructor.verdict, "likely-safe");
  assert.ok(safeConstructor.reachableCallables.some(({ name }) => name === "Safe.constructor"));

  const refutedConstructor = analyze({
    "entry.ts": "class Unsafe { constructor() { Math.random(); } } export function root() { new Unsafe(); return 1; }",
  });
  assert.equal(refutedConstructor.verdict, "refuted");
  assert.ok(refutedConstructor.findings.some(({ code }) => code === "RANDOMNESS"));

  const importedConstructor = analyze({
    "entry.ts": 'import { Imported } from "./constructor"; export function root() { new Imported(); return 1; }',
    "constructor.ts": "export class Imported { constructor() { Math.random(); } }",
  });
  assert.equal(importedConstructor.verdict, "refuted");
  assert.ok(importedConstructor.reachableCallables.some(({ name }) => name === "Imported.constructor"));

  const helperThroughField = analyze({
    "entry.ts": "function helper() { return Math.random(); } class WithField { value = helper(); constructor() {} } export function root() { new WithField(); return 1; }",
  });
  assert.equal(helperThroughField.verdict, "refuted");
  assert.ok(helperThroughField.reachableCallables.some(({ name }) => name === "helper"));
  assert.ok(helperThroughField.findings.some(({ code }) => code === "RANDOMNESS"));

  const composedConstruction = analyze({
    "entry.ts": "class Composed { value = Math.random(); constructor() { Date.now(); } } export function root() { new Composed(); return 1; }",
  });
  assert.equal(composedConstruction.verdict, "refuted");
  assert.ok(composedConstruction.findings.some(({ code }) => code === "RANDOMNESS"));
  assert.ok(composedConstruction.findings.some(({ code }) => code === "CLOCK_ACCESS"));
  console.log("unique member resolution verified");
});

test("ambiguous dispatch, unresolved modules, dynamic imports, and packages remain unknown", () => {
  const ambiguous = analyze({
    "entry.ts": "class First { run() { return 1; } } class Second { run() { return 2; } } export function root(flag: boolean) { const selected = flag ? new First() : new Second(); return selected.run(); }",
  });
  assert.equal(ambiguous.verdict, "unknown");
  assert.ok(ambiguous.findings.some(({ code }) => code === "UNKNOWN_CALL" || code === "AMBIGUOUS_DISPATCH"));

  const unresolved = analyze({ "entry.ts": 'import { missing } from "./does-not-exist"; export function root() { return missing(); }' });
  assert.equal(unresolved.verdict, "unknown");
  assert.ok(unresolved.findings.some(({ code }) => code === "UNKNOWN_MODULE"));

  const dynamic = analyze({ "entry.ts": 'export function root() { return import("./lazy"); }' });
  assert.equal(dynamic.verdict, "unknown");
  assert.ok(dynamic.findings.some(({ code }) => code === "UNKNOWN_MODULE"));

  const packaged = analyze({ "entry.ts": 'import { parse } from "opaque-package"; export function root(value: string) { return parse(value); }' });
  assert.equal(packaged.verdict, "unknown");
  assert.ok(packaged.findings.some(({ code }) => code === "PACKAGE_CALL"));

  const ambiguousConstructors = analyze({
    "entry.ts": "class First { constructor() { Math.random(); } } class Second { constructor() { Math.random(); } } export function root(flag: boolean) { const Candidate = flag ? First : Second; new Candidate(); return 1; }",
  });
  assert.equal(ambiguousConstructors.verdict, "unknown");
  assert.ok(ambiguousConstructors.findings.some(({ code }) => code === "UNKNOWN_CALL" || code === "AMBIGUOUS_DISPATCH"));

  const typeOnly = analyze({
    "entry.ts": 'import type { Boot } from "./boot"; export function root() { return 1; }',
    "boot.ts": "Date.now(); export type Boot = number;",
  });
  assert.equal(typeOnly.verdict, "likely-safe");
  assert.deepEqual(typeOnly.reachableModules, ["entry.ts"]);
  console.log("unknown evidence verified");
});

test("effects from an excluded reachable callee propagate to opted-in callers", () => {
  const result = analyze({
    "entry.ts": `/** @replaylock exclude reviewed boundary */
function excluded() { return Math.random(); }
export function root() { return excluded(); }`,
  });
  assert.equal(result.verdict, "refuted");
  const excluded = result.reachableCallables.find(({ name }) => name === "excluded");
  assert.equal(excluded?.excluded, true);
  assert.ok(result.findings.some(({ code }) => code === "RANDOMNESS"));
  console.log("excluded effect propagation verified");
});
