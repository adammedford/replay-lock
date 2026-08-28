import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "test", "fixtures", "core");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const vitestPath = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

test("source policy captures supported direct exports and excludes all other callables", async () => {
  const project = await makeProject({
    source: `/**
 * @replaylock capture
 * @replaylock assume-pure reviewed numeric {@link dependency}
 */
export function declared(value: number): number {
  return value + 1;
}

/** @replaylock capture */
export const expressed = function (value: number): number {
  return value * 2;
};

/** @replaylock capture */
export const arrowed = (value: number): number => value - 3;

/** @replaylock exclude intentionally outside {@link characterizationScope} */
export function excluded(value: number): number {
  return value / 2;
}

export const unannotated = (value: number): number => value ** 2;
`,
    test: `import { arrowed, declared, excluded, expressed, unannotated } from "../src/calculation.js";

test("existing coverage invokes every callable naturally", () => {
  expect(declared(4)).toBe(5);
  expect(expressed(4)).toBe(8);
  expect(arrowed(4)).toBe(1);
  expect(excluded(4)).toBe(2);
  expect(unannotated(4)).toBe(16);
});
`,
  });

  try {
    const result = runRecord(project);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /Recorded 3 candidate\(s\)/);

    const candidates = await pendingCandidates(project);
    assert.deepEqual(
      candidates.map((candidate) => candidate.locator),
      [
        { module: "src/calculation.ts", exportName: "arrowed" },
        { module: "src/calculation.ts", exportName: "declared" },
        { module: "src/calculation.ts", exportName: "expressed" },
      ],
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("invalid source policies fail closed without discarding an eligible capture", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function eligible(value: number): number {
  return value + 1;
}

/**
 * @replaylock capture
 * @replaylock assume-pure
 */
export function missingAssumptionReason(value: number): number {
  return value + 2;
}

/** @replaylock exclude */
export function missingExclusionReason(value: number): number {
  return value + 3;
}

/** @replaylock surprise */
export function unknownDirective(value: number): number {
  return value + 4;
}

/**
 * @replaylock capture
 * @replaylock exclude intentionally not persisted
 */
export function contradictory(value: number): number {
  return value + 5;
}

/** @replaylock capture */
export const misplaced = 6;

if (false) {
  /** @replaylock capture */
  const nestedMisplaced = 42;
}
`,
    test: `import {
  contradictory,
  eligible,
  misplaced,
  missingAssumptionReason,
  missingExclusionReason,
  unknownDirective,
} from "../src/calculation.js";

test("the module remains ordinarily executable", () => {
  expect(eligible(1)).toBe(2);
  expect(missingAssumptionReason(1)).toBe(3);
  expect(missingExclusionReason(1)).toBe(4);
  expect(unknownDirective(1)).toBe(5);
  expect(contradictory(1)).toBe(6);
  expect(misplaced).toBe(6);
});
`,
  });

  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /INVALID_POLICY.*assume-pure requires a nonempty reason/);
    assert.match(output(result), /INVALID_POLICY.*exclude requires a nonempty reason/);
    assert.match(output(result), /INVALID_POLICY.*unknown directive "surprise"/);
    assert.match(output(result), /INVALID_POLICY.*exclude cannot be combined with capture or assume-pure/);
    assert.match(output(result), /INVALID_POLICY.*directive is not attached to a callable/);
    assert.equal((output(result).match(/INVALID_POLICY/g) ?? []).length, 6, output(result));
    assert.doesNotMatch(output(result), /UNSUPPORTED_CALLABLE/);
    assert.match(output(result), /Recorded 1 candidate\(s\)/);

    const candidates = await pendingCandidates(project);
    assert.deepEqual(candidates.map((candidate) => candidate.locator.exportName), ["eligible"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("annotated unsupported callable shapes are reported while unannotated shapes stay untouched", async () => {
  const project = await makeProject({
    source: `function local(value: number): number {
  return value + 10;
}

function makeFunction(): (value: number) => number {
  return (value) => value + 9;
}

type NumberFunction = (value: number) => number;

const selectLocal = true;

/** @replaylock capture */
export function eligible(value: number): number {
  return value + 1;
}

/** @replaylock capture */
export const indirect = local;

function containsUnsupportedFactory(): number {
  /** @replaylock capture */
  const factoryResult = makeFunction();
  return factoryResult(1);
}

/** @replaylock capture */
export const conditional = selectLocal ? local : local;

/** @replaylock capture */
export const asserted = <NumberFunction>local;

/** @replaylock capture */
export default function defaulted(value: number): number {
  return value + 2;
}

/** @replaylock capture */
export function* generated(value: number): Generator<number> {
  yield value + 4;
}

/** @replaylock capture */
export let mutable = (value: number): number => value + 5;

export class Container {
  /** @replaylock capture */
  method(value: number): number {
    return value + 6;
  }

  /** @replaylock capture */
  field = (value: number): number => value + 7;
}

export const holder = {
  /** @replaylock capture */
  property: function (value: number): number {
    return value + 8;
  },
};

export function outer(value: number): number {
  /** @replaylock capture */
  function nested(inner: number): number {
    return inner + 7;
  }
  return nested(value);
}

function reexported(value: number): number {
  return value + 8;
}

/** @replaylock capture */
export { reexported };

function containsUnsupportedCommonJs(): void {
  /** @replaylock capture */
  module.exports.common = function (value: number): number {
    return value + 9;
  };
}

export const unannotatedIndirect = local;
`,
    test: `import defaulted, {
  asserted,
  conditional,
  Container,
  eligible,
  generated,
  holder,
  indirect,
  mutable,
  outer,
  reexported,
  unannotatedIndirect,
} from "../src/calculation.js";

test("unsupported shapes retain their ordinary behavior", () => {
  expect(eligible(1)).toBe(2);
  expect(asserted(1)).toBe(11);
  expect(indirect(1)).toBe(11);
  expect(conditional(1)).toBe(11);
  expect(defaulted(1)).toBe(3);
  expect(generated(1).next().value).toBe(5);
  expect(mutable(1)).toBe(6);
  expect(new Container().method(1)).toBe(7);
  expect(new Container().field(1)).toBe(8);
  expect(holder.property(1)).toBe(9);
  expect(outer(1)).toBe(8);
  expect(reexported(1)).toBe(9);
  expect(unannotatedIndirect(1)).toBe(11);
});
`,
  });

  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.equal((output(result).match(/UNSUPPORTED_CALLABLE/g) ?? []).length, 13, output(result));
    assert.doesNotMatch(output(result), /INVALID_POLICY/);
    assert.match(output(result), /Recorded 1 candidate\(s\)/);

    const candidates = await pendingCandidates(project);
    assert.deepEqual(candidates.map((candidate) => candidate.locator.exportName), ["eligible"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("callable locators reject project-root escape without losing local candidates", async () => {
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "replaylock-external-"));
  const externalPath = path.join(externalDirectory, "external.ts");
  await writeFile(
    externalPath,
    `/** @replaylock capture */
export function outside(value: number): number {
  return value + 20;
}
`,
  );
  const project = await makeProject({ source: "", test: "" });
  const externalSpecifier = path
    .relative(path.join(project, "src"), externalPath)
    .replaceAll(path.sep, "/");
  await writeFile(
    path.join(project, "src", "calculation.ts"),
    `import { outside } from ${JSON.stringify(externalSpecifier)};

/** @replaylock capture */
export function blockedByUnknownImport(value: number): number {
  return value + 1;
}

export function exerciseOutside(value: number): number {
  return outside(value);
}
`,
  );
  await writeFile(
    path.join(project, "src", "eligible.ts"),
    `/** @replaylock capture */
export function eligible(value: number): number { return value + 1; }
`,
  );
  await writeFile(
    path.join(project, "test", "calculation.test.ts"),
    `import { blockedByUnknownImport, exerciseOutside } from "../src/calculation.js";
import { eligible } from "../src/eligible.js";

test("local and outside callables both execute naturally", () => {
  expect(eligible(1)).toBe(2);
  expect(blockedByUnknownImport(1)).toBe(2);
  expect(exerciseOutside(1)).toBe(21);
});
`,
  );

  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /UNSUPPORTED_CALLABLE.*outside the project root/);
    assert.match(output(result), /UNKNOWN_EFFECT src\/calculation\.ts/);
    assert.match(output(result), /Recorded 1 candidate\(s\)/);

    const candidates = await pendingCandidates(project);
    assert.deepEqual(candidates.map((candidate) => candidate.locator), [{ module: "src/eligible.ts", exportName: "eligible" }]);
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("case artifacts reject traversal in callable module locators", async () => {
  const project = await makeProject({
    source: `/** @replaylock capture */
export function calculate(value: number): number {
  return value + 1;
}
`,
    test: `import { calculate } from "../src/calculation.js";

test("the calculation is exercised naturally", () => {
  expect(calculate(1)).toBe(2);
});
`,
  });

  try {
    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    const [candidate] = await pendingCandidates(project);
    assert.ok(candidate);
    candidate.locator.module = "src/../src/calculation.ts";
    const caseDirectory = path.join(project, ".replaylock", "cases");
    await mkdir(caseDirectory, { recursive: true });
    await writeFile(path.join(caseDirectory, "traversal.json"), `${JSON.stringify(candidate)}\n`);

    const verified = runCli(project, ["verify"]);
    assert.equal(verified.status, 2, output(verified));
    assert.match(output(verified), /Callable module locator must be normalized inside the project root/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("verification rejects a persisted locator that physically escapes through a symlink", async () => {
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "replaylock-case-external-"));
  const externalPath = path.join(externalDirectory, "calculation.ts");
  await writeFile(
    externalPath,
    `export function calculate(value: number): number {
  return value + 1;
}
`,
  );
  const project = await makeProject({
    source: `/** @replaylock capture */
export function calculate(value: number): number {
  return value + 1;
}
`,
    test: `import { calculate } from "../src/calculation.js";

test("the calculation is exercised naturally", () => {
  expect(calculate(1)).toBe(2);
});
`,
  });

  try {
    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    const [candidate] = await pendingCandidates(project);
    assert.ok(candidate);
    const caseDirectory = path.join(project, ".replaylock", "cases");
    await mkdir(caseDirectory, { recursive: true });
    await writeFile(path.join(caseDirectory, "escaped.json"), `${JSON.stringify(candidate)}\n`);

    const sourcePath = path.join(project, "src", "calculation.ts");
    await rm(sourcePath);
    await symlink(externalPath, sourcePath, "file");

    const verified = runCli(project, ["verify"]);
    assert.equal(verified.status, 2, output(verified));
    assert.match(output(verified), /ORPHANED_CALLABLE.*outside the project root/);
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("callable locators reject case-fold collisions", async (context) => {
  const project = await makeProject({ source: "", test: "" });
  const upperPath = path.join(project, "src", "CaseTarget.ts");
  const lowerPath = path.join(project, "src", "casetarget.ts");
  await writeFile(
    upperPath,
    `/** @replaylock capture */
export function upper(value: number): number {
  return value + 2;
}
`,
  );
  try {
    await writeFile(
      lowerPath,
      `/** @replaylock capture */
export function lower(value: number): number {
  return value + 3;
}
`,
      { flag: "wx" },
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      context.skip("the filesystem cannot represent distinct paths that differ only by case");
      await rm(project, { recursive: true, force: true });
      return;
    }
    throw error;
  }

  await writeFile(
    path.join(project, "src", "calculation.ts"),
    `import { upper } from "./CaseTarget.js";
import { lower } from "./casetarget.js";

/** @replaylock capture */
export function eligible(value: number): number {
  return value + 1;
}

export function exerciseCaseTargets(value: number): number {
  return upper(value) + lower(value);
}
`,
  );
  await writeFile(
    path.join(project, "test", "calculation.test.ts"),
    `import { eligible, exerciseCaseTargets } from "../src/calculation.js";

test("case-distinct modules execute naturally", () => {
  expect(eligible(1)).toBe(2);
  expect(exerciseCaseTargets(1)).toBe(7);
});
`,
  );

  try {
    const result = runRecord(project);
    assert.equal(result.status, 2, output(result));
    assert.equal((output(result).match(/UNSUPPORTED_CALLABLE.*ambiguous casing/g) ?? []).length, 2);
    assert.match(output(result), /Recorded 1 candidate\(s\)/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("verification rejects a persisted locator after a case-fold collision appears", async (context) => {
  const project = await makeProject({
    source: "",
    test: `import { upper } from "../src/CaseTarget.js";

test("the upper-case module is exercised naturally", () => {
  expect(upper(1)).toBe(3);
});
`,
  });
  const upperPath = path.join(project, "src", "CaseTarget.ts");
  const lowerPath = path.join(project, "src", "casetarget.ts");
  await writeFile(
    upperPath,
    `/** @replaylock capture */
export function upper(value: number): number {
  return value + 2;
}
`,
  );

  try {
    const recorded = runRecord(project);
    assert.equal(recorded.status, 0, output(recorded));
    const [candidate] = await pendingCandidates(project);
    assert.ok(candidate);
    const caseDirectory = path.join(project, ".replaylock", "cases");
    await mkdir(caseDirectory, { recursive: true });
    await writeFile(path.join(caseDirectory, "case-fold.json"), `${JSON.stringify(candidate)}\n`);

    try {
      await writeFile(
        lowerPath,
        `export function lower(value: number): number {
  return value + 3;
}
`,
        { flag: "wx" },
      );
    } catch (error) {
      if (error?.code === "EEXIST") {
        context.skip("the filesystem cannot represent distinct paths that differ only by case");
        return;
      }
      throw error;
    }

    const verified = runCli(project, ["verify"]);
    assert.equal(verified.status, 2, output(verified));
    assert.match(output(verified), /ORPHANED_CALLABLE.*ambiguous casing/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function makeProject({ source, test: testSource }) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-policy-"));
  await cp(fixtureRoot, project, { recursive: true });
  await writeFile(path.join(project, "src", "calculation.ts"), source);
  await writeFile(path.join(project, "test", "calculation.test.ts"), testSource);
  const nodeModules = path.join(project, "node_modules");
  await mkdir(nodeModules);
  await symlink(repositoryRoot, path.join(nodeModules, "replaylock"), process.platform === "win32" ? "junction" : "dir");
  return project;
}

function runRecord(project) {
  return runCli(project, [
    "record",
    "--",
    process.execPath,
    vitestPath,
    "run",
    "--config",
    "vitest.config.ts",
  ]);
}

function runCli(project, arguments_, input) {
  return spawnSync(
    process.execPath,
    [cliPath, ...arguments_],
    {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env },
      input,
      timeout: 30_000,
    },
  );
}

async function pendingCandidates(project) {
  const directory = path.join(project, ".replaylock", "observations", "pending");
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const candidates = await Promise.all(
    filenames.map(async (filename) => JSON.parse(await readFile(path.join(directory, filename), "utf8"))),
  );
  return candidates.sort((left, right) => left.locator.exportName.localeCompare(right.locator.exportName));
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
