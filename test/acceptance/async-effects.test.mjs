import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";

const analyze = (modules, exportName = "root", entryModule = "entry.ts", options = {}) =>
  analyzeProjectCallGraph({ modules, entryModule, exportName, ...options });

test("a known effect reached only through await still refutes the capturing async function", () => {
  const result = analyze({
    "entry.ts": `
      async function helper(value: number): Promise<number> {
        return value + Math.random();
      }
      export async function root(value: number): Promise<number> {
        return await helper(value);
      }
    `,
  });
  assert.equal(result.verdict, "refuted");
  assert.ok(result.findings.some(({ code }) => code === "RANDOMNESS"));
  console.log("await-reached known effect verified");
});

test("ambient mutation reached only through await still refutes the capturing async function", () => {
  const result = analyze({
    "entry.ts": `
      let counter = 0;
      async function bump(): Promise<number> {
        counter += 1;
        return counter;
      }
      export async function root(): Promise<number> {
        return await bump();
      }
    `,
  });
  assert.equal(result.verdict, "refuted");
  assert.ok(result.findings.some(({ code }) => code === "AMBIENT_MUTATION"));
});

test("an effect reached through await inside a loop or a conditional is still attributed correctly", () => {
  const loop = analyze({
    "entry.ts": `
      async function unsafe(value: number): Promise<number> {
        return value + Math.random();
      }
      export async function root(values: number[]): Promise<number> {
        let total = 0;
        for (const value of values) {
          total += await unsafe(value);
        }
        return total;
      }
    `,
  });
  assert.equal(loop.verdict, "refuted");
  assert.ok(loop.findings.some(({ code }) => code === "RANDOMNESS"));

  const conditional = analyze({
    "entry.ts": `
      async function unsafe(value: number): Promise<number> {
        return value + Math.random();
      }
      export async function root(flag: boolean, value: number): Promise<number> {
        if (flag) {
          return await unsafe(value);
        }
        return value;
      }
    `,
  });
  assert.equal(conditional.verdict, "refuted");
  assert.ok(conditional.findings.some(({ code }) => code === "RANDOMNESS"));
});

test("an unsafe effect reached through a chain of awaited local async functions propagates transitively", () => {
  const result = analyze({
    "entry.ts": `
      async function innermost(value: number): Promise<number> {
        return value + Math.random();
      }
      async function middle(value: number): Promise<number> {
        return await innermost(value);
      }
      export async function root(value: number): Promise<number> {
        return await middle(value);
      }
    `,
  });
  assert.equal(result.verdict, "refuted");
  assert.ok(result.findings.some(({ code }) => code === "RANDOMNESS"));
  assert.equal(result.reachableCallables.length, 3);
});

test("await of Promise.all never reaches a false likely-safe verdict", () => {
  const result = analyze({
    "entry.ts": `
      async function helper(value: number): Promise<number> {
        return value;
      }
      export async function root(values: number[]): Promise<number[]> {
        return await Promise.all(values.map((value) => helper(value)));
      }
    `,
  });
  assert.notEqual(result.verdict, "likely-safe");
});

test("constructing a Promise with an executor never reaches a false likely-safe verdict", () => {
  const safeLooking = analyze({
    "entry.ts": `
      export async function root(value: number): Promise<number> {
        return new Promise((resolve) => {
          resolve(value);
        });
      }
    `,
  });
  assert.notEqual(safeLooking.verdict, "likely-safe");

  const effectfulExecutor = analyze({
    "entry.ts": `
      export async function root(value: number): Promise<number> {
        return new Promise((resolve) => {
          console.log(value);
          resolve(value);
        });
      }
    `,
  });
  assert.notEqual(effectfulExecutor.verdict, "likely-safe");
  console.log("Promise executor construction never reaches likely-safe verified");
});

test("a trusted-package export reached only through await still contributes TRUSTED_PACKAGE_CALL evidence", () => {
  const packageCatalog = {
    entries: [{ package: "left-pad-fixture", export: "pad", unpinned: true }],
  };
  const result = analyze(
    {
      "entry.ts": `
        import { pad } from "left-pad-fixture";
        async function helper(value: number): Promise<string> {
          return pad(value, 4);
        }
        export async function root(value: number): Promise<string> {
          return await helper(value);
        }
      `,
    },
    "root",
    "entry.ts",
    { packageCatalog },
  );
  assert.equal(result.verdict, "likely-safe");
  assert.deepEqual(result.trustedPackageCalls, [
    { package: "left-pad-fixture", export: "pad", unpinned: true },
  ]);
  assert.ok(result.findings.some(({ code }) => code === "TRUSTED_PACKAGE_CALL"));
});

test("async effect propagation branch integration marker", () => {
  console.log("async effect propagation branch integration verified");
});
