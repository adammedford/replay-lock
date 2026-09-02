import assert from "node:assert/strict";
import test from "node:test";
import { parseAndAnalyzeDirectEffects } from "../../dist/effect-analyzer.js";

test("eligible local calculations and deterministic intrinsics remain likely-safe", () => {
  const result = analyze(`
const SCALE = 2;
const NORMALIZED_SCALE = Math.abs(SCALE);

export function calculate(input: number, enabled: boolean): number {
  const values = [input];
  values.push(Math.abs(input), Math.max(input, NORMALIZED_SCALE));
  const record = { total: 0 };
  record.total = values.reduce((sum, value) => sum + value, 0);
  let answer = record.total;
  if (enabled) answer += Number.parseInt("4", 10);
  else if (input < 0) throw new RangeError("negative");
  return answer;
}
`);

  assert.deepEqual(result, {
    verdict: "likely-safe",
    analyzerVersion: "1",
    findings: [],
  });
  console.log("direct effect eligibility verified");
});

test("fresh nested literals preserve copied primitives but reject nested argument aliases", () => {
  const safe = analyze(`
export function calculate(input: { value: number }): number {
  const local = { nested: { x: input.value.toString().length } };
  local.nested.x++;
  return local.nested.x;
}
`);
  assert.equal(safe.verdict, "likely-safe");
  assert.deepEqual(safe.findings, []);

  const unsafe = analyze(`
export function calculate(input: { nested: { value: number } }): number {
  const local = { nested: input.nested };
  local.nested.value++;
  return local.nested.value;
}
`);
  assert.equal(unsafe.verdict, "refuted");
  assert.ok(unsafe.findings.some(({ code }) => code === "ARGUMENT_MUTATION"));
});

const refutingFixtures = [
  ["ARGUMENT_MUTATION", "input.value++"],
  ["ARGUMENT_MUTATION", "const alias = input; alias.value++"],
  ["ARGUMENT_MUTATION", "Object.assign(input, { value: 2 })"],
  ["RECEIVER_DEPENDENCE", "return this.value"],
  ["AMBIENT_MUTATION", "counter++"],
  ["CLOCK_ACCESS", "return Date.now()"],
  ["RANDOMNESS", "return Math.random()"],
  ["IO", "return readFileSync(\"fixture.txt\", \"utf8\").length", 'import { readFileSync } from "node:fs";'],
  ["ENVIRONMENT_DEPENDENCE", "return process.env.PORT?.length ?? 0"],
  ["LOCALE_DEPENDENCE", "return input.value.toLocaleString().length"],
  ["LOGGING", "console.log(input.value)"],
  ["DYNAMIC_EVALUATION", 'return eval("1 + 1")'],
];

test("every specified direct effect refutes eligibility", () => {
  for (const [expectedCode, statement, prelude = ""] of refutingFixtures) {
    const result = analyze(`${prelude}
let counter = 0;
export function calculate(input: { value: number }): number {
  ${statement};
  return input.value;
}
`);
    assert.equal(result.verdict, "refuted", expectedCode);
    assert.ok(result.findings.some(({ code }) => code === expectedCode), expectedCode);
  }

  const initialized = analyze(`
function initialize(): number { return 1; }
const boot = initialize();
export function calculate(input: number): number { return input + boot; }
`);
  assert.equal(initialized.verdict, "refuted");
  assert.ok(initialized.findings.some(({ code }) => code === "EFFECTFUL_INITIALIZATION"));
  console.log("direct refuting effects verified");
});

test("blocking findings use stable codes and authored source locations", () => {
  const source = `export function calculate(input: { value: number }): number {
  console.warn(input.value);
  input.value = Date.now();
  return input.value;
}
`;
  const first = analyze(source);
  const second = analyze(source);
  assert.deepEqual(second, first);
  assert.equal(first.verdict, "refuted");
  assert.deepEqual(
    first.findings.map(({ code, source, line, column }) => ({ code, source, line, column })),
    [
      { code: "LOGGING", source: "src/calculation.ts", line: 2, column: 3 },
      { code: "ARGUMENT_MUTATION", source: "src/calculation.ts", line: 3, column: 3 },
      { code: "CLOCK_ACCESS", source: "src/calculation.ts", line: 3, column: 17 },
    ],
  );
  for (const finding of first.findings) {
    assert.match(finding.code, /^[A-Z][A-Z_]+$/);
    assert.ok(finding.message.length > 10);
  }
  console.log("effect diagnostics verified");
});

test("runtime observations cannot upgrade or relabel the static verdict", () => {
  const source = `export function calculate(): number { return Math.random(); }`;
  const result = analyze(source);
  assert.equal(result.verdict, "refuted");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.findings));
  assert.ok(result.findings.every(Object.isFrozen));
  assert.throws(() => {
    result.verdict = "likely-safe";
  }, TypeError);

  globalThis.__replaylockRuntimeObservation = { repeatedOutputsMatched: true };
  try {
    assert.deepEqual(analyze(source), result);
  } finally {
    delete globalThis.__replaylockRuntimeObservation;
  }
  console.log("static verdict separation verified");
});

test("black-box fixtures distinguish eligible calculations from all direct refuting categories", () => {
  assert.equal(analyze(`export const calculate = (value: number) => Math.trunc(value * 2);`).verdict, "likely-safe");
  for (const [expectedCode, statement, prelude = ""] of refutingFixtures) {
    const analysis = analyze(`${prelude}
let counter = 0;
export const calculate = function (input: { value: number }): number {
  ${statement};
  return input.value;
};`);
    assert.equal(analysis.verdict, "refuted");
    assert.ok(analysis.findings.some((finding) => finding.code === expectedCode));
  }
  console.log("effect fixture matrix verified");
});

test("class runtime evaluation visits only executable heritage, computed keys, static fields, and blocks", () => {
  const cases = [
    ["CLOCK_ACCESS", "class Derived extends (Date.now(), Object) {}"],
    ["CLOCK_ACCESS", "class Derived { [Date.now()]() {} }"],
    ["RANDOMNESS", "class Derived { static value = Math.random(); }"],
    ["LOGGING", "class Derived { static { console.log(input); } }"],
  ];
  for (const [code, declaration] of cases) {
    const result = analyze(`
export function calculate(input: number): number {
  ${declaration}
  return input;
}
`);
    assert.equal(result.verdict, "refuted", declaration);
    assert.ok(result.findings.some((finding) => finding.code === code), declaration);
  }

  const safe = analyze(`
export function calculate(input: number): number {
  class Derived { method() { return Date.now(); } }
  return input;
}
`);
  assert.equal(safe.verdict, "likely-safe");
  assert.deepEqual(safe.findings, []);
});

test("destructuring writes classify argument, receiver, and ambient targets while preserving local controls", () => {
  const fixtures = [
    ["ARGUMENT_MUTATION", "[input.value] = [2];"],
    ["ARGUMENT_MUTATION", "({ nested: input.nested } = { nested: { value: 2 } });"],
    ["RECEIVER_DEPENDENCE", "({ value: this.value } = { value: input });"],
    ["AMBIENT_MUTATION", "({ value: ambientValue } = { value: input });"],
  ];
  for (const [code, statement] of fixtures) {
    const result = analyze(`
let ambientValue = 0;
export function calculate(input: { value: number; nested?: { value: number } } | number): number {
  ${statement}
  return typeof input === "number" ? input : input.value;
}
`);
    assert.equal(result.verdict, "refuted", statement);
    assert.ok(result.findings.some((finding) => finding.code === code), statement);
  }

  const safe = analyze(`
export function calculate(input: number): number {
  let left = 0;
  let right = 0;
  [left, right] = [input, input + 1];
  ({ left, right } = { left: right, right: left });
  return left + right;
}
`);
  assert.equal(safe.verdict, "likely-safe");
  assert.deepEqual(safe.findings, []);
});

function analyze(sourceText) {
  return parseAndAnalyzeDirectEffects(sourceText, "src/calculation.ts", "calculate");
}
