import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate, toCaseArtifact } from "../../dist/model.js";
import { createAssumptionFingerprint, unknownEvidence } from "../../dist/assumptions.js";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";
import { INTRINSIC_CATALOG_VERSION } from "../../dist/effect-analyzer.js";

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

test("accepted artifacts replay in an ephemeral fresh-process Vitest harness", async () => {
  await withProject(
    assumedCapture(`export function target(value: number): boolean {
  return value === 7 && isFreshProcess();
}`),
    async (project) => {
      await writeAssumedCase(project, [7], { kind: "return", value: true });
      const before = await acceptedBytes(project);
      const result = runVerify(project);
      assert.equal(result.status, 0, output(result));
      assert.match(output(result), /Verified 1 case\(s\)/);
      assert.deepEqual(await readdir(path.join(project, ".replaylock", "verify")), []);
      assert.deepEqual(await acceptedBytes(project), before);
    },
  );
});

test("structural output and completion-kind mismatches have distinct diagnostics", async () => {
  await withProject(capture(`export function target(): unknown { return { items: [1, 3] }; }`), async (project) => {
    await writeCase(project, [], { kind: "return", value: { items: [1, 2] } });
    const result = runVerify(project);
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#target/);
    assert.match(output(result), /\$\.items\[1\]: expected 2; received 3/);
  });

  await withProject(assumedCapture(`export function target(): never { throw new Error("changed"); }`), async (project) => {
    await writeAssumedCase(project, [], { kind: "return", value: 1 });
    const result = runVerify(project);
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /COMPLETION_KIND_MISMATCH src\/calculation\.ts#target/);
    assert.match(output(result), /expected return; received throw/);
    assert.doesNotMatch(output(result), /OUTPUT_MISMATCH/);
  });
});

test("standard errors compare by stable name and message with safe readable diffs", async () => {
  await withProject(assumedCapture(`export function target(value: number): number {
  if (value < 0) throw new RangeError("stable");
  return value;
}`), async (project) => {
    await writeAssumedCase(project, [-1], { kind: "throw", value: new RangeError("stable") });
    const initial = runVerify(project);
    assert.equal(initial.status, 0, output(initial));
  });
  await withProject(assumedCapture(`export function target(value: number): number {
  if (value < 0) throw new RangeError("changed");
  return value;
}`), async (project) => {
    await writeAssumedCase(project, [-1], { kind: "throw", value: new RangeError("stable") });
    const result = runVerify(project);
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /\$\.error\.message: expected "stable"; received "changed"/);
    assert.doesNotMatch(output(result), /at .*calculation|stack/);
  });

  await withProject(
    capture(`export function target(): unknown { return { password: "DO_NOT_LEAK" }; }`),
    async (project) => {
      await writeCase(project, [], { kind: "return", value: 1 });
      const result = runVerify(project);
      assert.equal(result.status, 1, output(result));
      assert.match(output(result), /OUTPUT_MISMATCH/);
      assert.match(output(result), /received \[REDACTED\]/);
      assert.doesNotMatch(output(result), /DO_NOT_LEAK|password/i);
    },
  );
});

test("verify exit codes distinguish success behavioral failure and infrastructure failure", async () => {
  await withProject(capture(`export function target(): number { return 1; }`), async (project) => {
    await writeCase(project, [], { kind: "return", value: 1 });
    assert.equal(runVerify(project).status, 0);
  });
  await withProject(capture(`export function target(): number { return 2; }`), async (project) => {
    await writeCase(project, [], { kind: "return", value: 1 });
    assert.equal(runVerify(project).status, 1);
  });
  await withProject(capture(`export function target(): number { return 1; }`), async (project) => {
    await writeCase(project, [], { kind: "return", value: 1 });
    await writeFile(path.join(project, "src", "calculation.ts"), capture(`export function target(: number {`));
    const result = runVerify(project);
    assert.equal(result.status, 2, output(result));
    assert.doesNotMatch(output(result), /OUTPUT_MISMATCH|COMPLETION_KIND_MISMATCH/);
  });
});

test("verification is read-only for accepted artifacts on success and every failure class", async () => {
  for (const scenario of ["success", "behavior", "infrastructure"]) {
    await withProject(capture(`export function target(): number { return 1; }`), async (project) => {
      await writeCase(project, [], { kind: "return", value: scenario === "behavior" ? 2 : 1 });
      if (scenario === "infrastructure") {
        await writeFile(path.join(project, "src", "calculation.ts"), capture(`export function target(: number {`));
      }
      const before = await acceptedBytes(project);
      runVerify(project);
      assert.deepEqual(await acceptedBytes(project), before, `${scenario} changed accepted cases`);
    });
  }
});

test("stable locators and behavior survive formatting extraction and implementation replacement", async () => {
  const sources = [
    capture(`export function target(value: number): number { return value + 1; }`),
    `function increment(value: number): number { return value + 1; }
/** @replaylock capture */
export function target(value: number): number { return increment(value); }
`,
    capture(`export function target(value: number): number {
  const replacement = 1;
  return replacement + value;
}`),
  ];
  await withProject(sources[0], async (project) => {
    await writeCase(project, [2], { kind: "return", value: 3 });
    for (const source of sources) {
      await writeFile(path.join(project, "src", "calculation.ts"), source);
      const result = runVerify(project);
      assert.equal(result.status, 0, output(result));
    }
  });
});

async function withProject(source, body) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-replay-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "cases"), { recursive: true });
  await mkdir(path.join(project, ".replaylock", "verify"), { recursive: true });
  await mkdir(path.join(project, "node_modules", "fresh-process-proof"), { recursive: true });
  await writeFile(path.join(project, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
  await writeFile(path.join(project, "src", "calculation.ts"), source);
  await writeFile(
    path.join(project, "node_modules", "fresh-process-proof", "package.json"),
    `${JSON.stringify({ type: "module", exports: "./index.js" })}\n`,
  );
  await writeFile(
    path.join(project, "node_modules", "fresh-process-proof", "index.js"),
    `export function isFreshProcess() {
  const cliPid = process.env.REPLAYLOCK_CLI_PID;
  return typeof cliPid === "string" && process.pid !== Number(cliPid);
}\n`,
  );
  try {
    await body(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function capture(declaration) {
  return `/** @replaylock capture */\n${declaration}\n`;
}

function assumedCapture(declaration) {
  return `import { isFreshProcess } from "fresh-process-proof";\n/**\n * @replaylock capture\n * @replaylock assume-pure reviewed process identity boundary\n */\n${declaration}\n`;
}

async function writeCase(project, arguments_, completion) {
  const candidate = createCandidate({
    token: "t".repeat(64),
    locator: { module: "src/calculation.ts", exportName: "target" },
    arguments: arguments_,
    completion,
    sourceGraphDigest: digest,
    runtimeProfile,
  }, digest);
  const casePath = path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`);
  await writeFile(casePath, artifactJson(toCaseArtifact(candidate)));
  return casePath;
}

async function writeAssumedCase(project, arguments_, completion) {
  const source = await readFile(path.join(project, "src", "calculation.ts"), "utf8");
  const modules = { "src/calculation.ts": source };
  const analysis = analyzeProjectCallGraph({
    modules,
    entryModule: "src/calculation.ts",
    exportName: "target",
  });
  assert.equal(analysis.verdict, "unknown");
  const assumption = {
    reason: "reviewed process identity boundary",
    fingerprint: createAssumptionFingerprint({ modules, analysis, projectRoot: project }),
    originalEvidence: unknownEvidence(analysis.findings).map((finding) => ({ ...finding })),
    analyzerVersion: analysis.analyzerVersion,
    intrinsicCatalogVersion: INTRINSIC_CATALOG_VERSION,
  };
  const candidate = createCandidate({
    token: "t".repeat(64),
    locator: { module: "src/calculation.ts", exportName: "target" },
    arguments: arguments_,
    completion,
    sourceGraphDigest: digest,
    runtimeProfile,
    assumption,
  }, digest);
  const casePath = path.join(project, ".replaylock", "cases", `${candidate.caseId}.json`);
  await writeFile(casePath, artifactJson(toCaseArtifact(candidate)));
  return casePath;
}

function runVerify(project) {
  return spawnSync(process.execPath, [cliPath, "verify"], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

async function acceptedBytes(project) {
  const directory = path.join(project, ".replaylock", "cases");
  const filenames = await readdir(directory);
  filenames.sort();
  return Promise.all(filenames.map(async (filename) => [filename, await readFile(path.join(directory, filename))]));
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
