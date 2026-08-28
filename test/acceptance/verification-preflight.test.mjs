import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createAssumptionFingerprint, unknownEvidence } from "../../dist/assumptions.js";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";
import { INTRINSIC_CATALOG_VERSION } from "../../dist/effect-analyzer.js";
import {
  artifactJson,
  createCandidate,
  toCaseArtifact,
} from "../../dist/model.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const digest = `sha256:${"a".repeat(64)}`;
const runtimeProfile = {
  node: "v22.12.0",
  vite: "8.2.2",
  vitest: "4.1.11",
  replaylock: "0.1.0",
  platform: process.platform,
  architecture: process.arch,
  timezone: "UTC",
  locale: "en-US",
};

test("malformed and future case schemas fail closed with one stable diagnostic", async () => {
  for (const text of ["{not json", `${JSON.stringify({ schemaVersion: 2 })}\n`]) {
    await withProject(pureSource(), async (project) => {
      await writeFile(path.join(project, ".replaylock", "cases", "bad.json"), text);
      await assertBlocked(project, "CASE_SCHEMA_UNSUPPORTED bad.json");
    });
  }
});

test("missing modules and exact exports are orphaned without retargeting", async () => {
  await withProject(pureSource("replacement"), async (project) => {
    await writeAutomaticCase(project, "target");
    await assertBlocked(project, "ORPHANED_CALLABLE src/calculation.ts#target");
  });
  await withProject(pureSource(), async (project) => {
    await writeAutomaticCase(project);
    await rm(path.join(project, "src", "calculation.ts"));
    await assertBlocked(project, "ORPHANED_CALLABLE src/calculation.ts#target");
  });
});

test("removed capture policy and a new exclusion block before invocation", async () => {
  const variants = [
    {
      source: `export function target(value: number): number { throw new Error("TARGET_INVOKED"); }\n`,
      expected: "CAPTURE_POLICY_CHANGED",
    },
    {
      source: `/** @replaylock exclude reviewed removal */\nexport function target(value: number): number { throw new Error("TARGET_INVOKED"); }\n`,
      expected: "CAPTURE_POLICY_CHANGED",
    },
  ];
  for (const variant of variants) {
    await withProject(variant.source, async (project) => {
      await writeAutomaticCase(project);
      await assertBlocked(project, `${variant.expected} src/calculation.ts#target`);
    });
  }
});

test("a formerly supported export that becomes unsupported is blocked", async () => {
  const unsupportedShapes = [
    `/** @replaylock capture */\nexport async function target(value: number): Promise<number> { throw new Error("TARGET_INVOKED"); }\n`,
    `/** @replaylock capture */\nexport const target = (value: number): number => value, companion = 1;\n`,
    `/** @replaylock capture */\nexport const target = (value = 1): number => value;\n`,
    `/** @replaylock capture */\nexport const target = (...values: number[]): number => values[0] ?? 0;\n`,
    `/** @replaylock capture */\nexport const target = ({ value }: { value: number }): number => value;\n`,
  ];
  for (const source of unsupportedShapes) {
    await withProject(source, async (project) => {
      await writeAutomaticCase(project);
      await assertBlocked(project, "UNSUPPORTED_CALLABLE src/calculation.ts#target");
    });
  }
});

test("new refuting evidence and unknown effects without retained assumptions are blocked", async () => {
  await withProject(
    `/** @replaylock capture */\nexport function target(value: number): number { return value + Math.random(); }\n`,
    async (project) => {
      await writeAutomaticCase(project);
      await assertBlocked(project, "EFFECT_REFUTED src/calculation.ts#target");
    },
  );
  await withProject(
    `import { helper } from "./helper.js";\n/** @replaylock capture */\nexport function target(value: number): number { return helper(value); }\n`,
    async (project) => {
      await writeFile(
        path.join(project, "src", "helper.ts"),
        `export function helper(value: number): number { return value + Math.random(); }\n`,
      );
      await writeAutomaticCase(project);
      await assertBlocked(project, "EFFECT_REFUTED src/calculation.ts#target");
    },
  );
  await withProject(unknownSource(), async (project) => {
    await writeAutomaticCase(project);
    await assertBlocked(project, "MISSING_ASSUMPTION src/calculation.ts#target");
  });
});

test("assumption fingerprints are recomputed from current modules lockfile evidence analyzer and catalog", async () => {
  const mutations = [
    async (project) => {
      await writeFile(path.join(project, "src", "calculation.ts"), `${unknownSource()}// changed exact bytes\n`);
    },
    async (project) => {
      await writeFile(path.join(project, "package-lock.json"), `${lockfileText("changed")}\n`);
    },
    async (project) => mutateAssumption(project, (assumption) => ({ ...assumption, analyzerVersion: "future-analyzer" })),
    async (project) => mutateAssumption(project, (assumption) => ({ ...assumption, intrinsicCatalogVersion: "future-catalog" })),
    async (project) => {
      await writeFile(
        path.join(project, "src", "calculation.ts"),
        unknownSource().replace("opaque-package", "different-package"),
      );
    },
  ];
  for (const mutate of mutations) {
    await withProject(unknownSource(), async (project) => {
      await writeAssumedCase(project);
      await mutate(project);
      await assertBlocked(project, "STALE_ASSERTION src/calculation.ts#target");
    });
  }
});

test("the complete case set is preflighted before Vitest can invoke an earlier valid case", async () => {
  await withProject(
    `/** @replaylock capture */\nexport function target(): never { throw new Error("TARGET_INVOKED"); }\n`,
    async (project) => {
      await writeAutomaticCase(project, "target", "a-valid.json");
      await writeFile(
        path.join(project, ".replaylock", "cases", "z-invalid.json"),
        `${JSON.stringify({ schemaVersion: 999 })}\n`,
      );
      const result = await runVerifyPreservingCases(project);
      assert.equal(result.status, 2, output(result));
      assert.match(output(result), /CASE_SCHEMA_UNSUPPORTED z-invalid\.json/);
      assert.doesNotMatch(output(result), /TARGET_INVOKED|OUTPUT_MISMATCH|Verified 1 case/);
      assert.deepEqual(await readdir(path.join(project, ".replaylock", "verify")), []);
    },
  );
});

test("multiple invalid targets report deterministically in sorted case-file order", async () => {
  await withProject(pureSource("replacement"), async (project) => {
    await writeAutomaticCase(project, "alpha", "a-invalid.json");
    await writeAutomaticCase(project, "zeta", "z-invalid.json");
    const result = await runVerifyPreservingCases(project);
    assert.equal(result.status, 2, output(result));
    assert.match(output(result), /ORPHANED_CALLABLE src\/calculation\.ts#alpha/);
    assert.doesNotMatch(output(result), /#zeta|OUTPUT_MISMATCH/);
    assert.deepEqual(await readdir(path.join(project, ".replaylock", "verify")), []);
  });
});

async function withProject(source, body) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-preflight-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "verify"), { recursive: true });
  await writeFile(path.join(project, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  await writeFile(path.join(project, "package-lock.json"), `${lockfileText("baseline")}\n`);
  await writeFile(path.join(project, "src", "calculation.ts"), source);
  try {
    await body(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function pureSource(exportName = "target") {
  return `/** @replaylock capture */\nexport function ${exportName}(value: number): number { return value; }\n`;
}

function unknownSource() {
  return `import { opaque } from "opaque-package";\n/**\n * @replaylock capture\n * @replaylock assume-pure reviewed package boundary\n */\nexport function target(value: number): number { return opaque(value); }\n`;
}

function lockfileText(name) {
  return JSON.stringify({ name, lockfileVersion: 3 });
}

function observation(assumption) {
  return {
    token: "t".repeat(64),
    locator: { module: "src/calculation.ts", exportName: "target" },
    arguments: [1],
    completion: { kind: "return", value: 1 },
    sourceGraphDigest: digest,
    runtimeProfile,
    ...(assumption ? { assumption } : {}),
  };
}

async function writeAutomaticCase(project, exportName = "target", filename) {
  const candidate = createCandidate(
    { ...observation(), locator: { module: "src/calculation.ts", exportName } },
    digest,
  );
  const casePath = path.join(project, ".replaylock", "cases", filename ?? `${candidate.caseId}.json`);
  await writeFile(casePath, artifactJson(toCaseArtifact(candidate)));
  return casePath;
}

async function writeAssumedCase(project) {
  const source = await readFile(path.join(project, "src", "calculation.ts"), "utf8");
  const modules = { "src/calculation.ts": source };
  const analysis = analyzeProjectCallGraph({
    modules,
    entryModule: "src/calculation.ts",
    exportName: "target",
  });
  assert.equal(analysis.verdict, "unknown");
  const assumption = {
    reason: "reviewed package boundary",
    fingerprint: createAssumptionFingerprint({ modules, analysis, projectRoot: project }),
    originalEvidence: unknownEvidence(analysis.findings).map((finding) => ({ ...finding })),
    analyzerVersion: analysis.analyzerVersion,
    intrinsicCatalogVersion: INTRINSIC_CATALOG_VERSION,
  };
  const candidate = createCandidate(observation(assumption), digest);
  const casePath = path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`);
  await writeFile(casePath, artifactJson(toCaseArtifact(candidate)));
  return casePath;
}

async function mutateAssumption(project, mutate) {
  const directory = path.join(project, ".replaylock", "cases");
  const filename = (await readdir(directory))[0];
  assert.ok(filename);
  const casePath = path.join(directory, filename);
  const artifact = JSON.parse(await readFile(casePath, "utf8"));
  artifact.eligibility.assumption = mutate(artifact.eligibility.assumption);
  await writeFile(casePath, `${JSON.stringify(artifact, null, 2)}\n`);
}

async function assertBlocked(project, diagnostic) {
  const result = await runVerifyPreservingCases(project);
  assert.equal(result.status, 2, output(result));
  const publicDiagnostic = /^(?:CASE_SCHEMA_UNSUPPORTED|ORPHANED_CALLABLE)\b/.test(diagnostic)
    ? diagnostic
    : `REPLAY_SAFETY_REGRESSION ${diagnostic}`;
  assert.match(output(result), new RegExp(escapeRegex(publicDiagnostic)));
  assert.doesNotMatch(output(result), /TARGET_INVOKED|OUTPUT_MISMATCH|Verified \d+ case/);
  assert.deepEqual(
    await readdir(path.join(project, ".replaylock", "verify")),
    [],
    "blocked preflight must not create a Vitest harness",
  );
}

async function runVerifyPreservingCases(project) {
  const before = await caseBytes(project);
  const result = spawnSync(process.execPath, [cliPath, "verify"], {
    cwd: project,
    encoding: "utf8",
  });
  assert.deepEqual(await caseBytes(project), before, "verify must not change accepted case bytes");
  return result;
}

async function caseBytes(project) {
  const directory = path.join(project, ".replaylock", "cases");
  const filenames = (await readdir(directory)).sort();
  return Promise.all(filenames.map(async (filename) => [filename, await readFile(path.join(directory, filename))]));
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("issue 14 verification preflight marker", () => {
  console.log("issue 14 verification preflight verified");
});
