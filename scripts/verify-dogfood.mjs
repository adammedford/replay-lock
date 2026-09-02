import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDirectory = path.join(root, ".replaylock", "cases");
const sourcePath = path.join(root, "src", "typescript-script-kind.ts");
const cliPath = path.join(root, "dist", "cli.js");

assert.equal(process.versions.node.split(".")[0], "22", "dogfood verification must use Node 22");

const filenames = (await readdir(casesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
assert.equal(filenames.length, 6, "dogfood must contain exactly six accepted cases");

const originalCases = await caseBytes();
const artifacts = await Promise.all(
  filenames.map(async (filename) => {
    const artifact = JSON.parse(await readFile(path.join(casesDirectory, filename), "utf8"));
    assert.equal(filename, `${artifact.caseId}.json`, "case filename must match its reviewed identity");
    assert.equal(artifact.schemaVersion, 1);
    assert.equal(artifact.locator.module, "src/typescript-script-kind.ts");
    assert.equal(artifact.arguments.kind, "array");
    assert.equal(artifact.arguments.items.length, 1, "every dogfood case must have one reviewed argument");
    assert.equal(artifact.arguments.items[0]?.kind, "string");
    assert.equal(artifact.completion.kind, "return");
    assert.ok(["boolean", "number"].includes(artifact.completion.value?.kind));
    assert.equal(artifact.comparison, "exact");
    assert.equal(artifact.eligibility.basis, "assumption");
    assert.equal(artifact.eligibility.verdict, "likely-safe");
    assert.deepEqual(artifact.eligibility.reasonCodes, ["ASSUMED_UNKNOWN_EFFECT"]);
    assert.ok(
      artifact.eligibility.assumption.originalEvidence.some((finding) => finding.code === "PACKAGE_CALL"),
      "every reviewed assumption must retain its package-boundary evidence",
    );
    assert.match(artifact.provenance.sourceGraphDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(artifact.provenance.lockfileDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(artifact.provenance.runtimeProfile.node, "v22.19.0");
    assert.equal(artifact.provenance.runtimeProfile.vite, "8.2.2");
    assert.equal(artifact.provenance.runtimeProfile.vitest, "4.1.11");
    assert.equal(artifact.provenance.runtimeProfile.replaylock, "0.1.0");
    assert.equal(artifact.provenance.captureStatus, "complete");
    return artifact;
  }),
);

const reviewedBehavior = artifacts
  .map((artifact) => ({
    exportName: artifact.locator.exportName,
    argument: artifact.arguments.items[0]?.value,
    completion: artifact.completion.value?.value,
    reason: artifact.eligibility.assumption.reason,
  }))
  .sort((left, right) => `${left.exportName}:${left.argument}`.localeCompare(`${right.exportName}:${right.argument}`));

assert.deepEqual(reviewedBehavior, [
  {
    exportName: "isTypeScriptSourceFilename",
    argument: "README.md",
    completion: false,
    reason: "reviewed deterministic RegExp boundary",
  },
  {
    exportName: "isTypeScriptSourceFilename",
    argument: "sample.ts",
    completion: true,
    reason: "reviewed deterministic RegExp boundary",
  },
  {
    exportName: "typescriptScriptKind",
    argument: "module.mjs",
    completion: 1,
    reason: "reviewed deterministic TypeScript ScriptKind boundary",
  },
  {
    exportName: "typescriptScriptKind",
    argument: "module.ts",
    completion: 3,
    reason: "reviewed deterministic TypeScript ScriptKind boundary",
  },
  {
    exportName: "typescriptScriptKind",
    argument: "view.jsx",
    completion: 2,
    reason: "reviewed deterministic TypeScript ScriptKind boundary",
  },
  {
    exportName: "typescriptScriptKind",
    argument: "view.tsx",
    completion: 4,
    reason: "reviewed deterministic TypeScript ScriptKind boundary",
  },
]);
assert.equal(new Set(artifacts.map((artifact) => artifact.provenance.sourceGraphDigest)).size, 1);
assert.equal(new Set(artifacts.map((artifact) => artifact.provenance.lockfileDigest)).size, 1);
for (const exportName of ["isTypeScriptSourceFilename", "typescriptScriptKind"]) {
  assert.equal(
    new Set(
      artifacts
        .filter((artifact) => artifact.locator.exportName === exportName)
        .map((artifact) => artifact.eligibility.assumption.fingerprint),
    ).size,
    1,
    `${exportName} cases must share the individually reviewed assumption fingerprint`,
  );
}

const workflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const completeSuite = "run: npm run verify --";
const dogfoodSuite = "run: npm run verify:dogfood";
assert.equal(workflow.split(completeSuite).length - 1, 1, "CI must run the complete suite exactly once");
assert.equal(workflow.split(dogfoodSuite).length - 1, 1, "CI must run dogfood exactly once");
assert.ok(
  workflow.indexOf(dogfoodSuite) > workflow.indexOf(completeSuite),
  "CI dogfood replay must follow the complete suite",
);

runNode([path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"]);
const verified = runCli(0);
assert.match(verified, /Verified 6 case\(s\)/);
assert.deepEqual(await caseBytes(), originalCases, "successful replay must not update accepted cases");

const originalSource = await readFile(sourcePath, "utf8");
const mutationAnchor = "return supportedSourceExtension.test(filename);";
assert.equal(originalSource.split(mutationAnchor).length - 1, 1, "mutation control must have one exact source target");
const mutatedSource = originalSource.replace(
  mutationAnchor,
  `${mutationAnchor} // disposable dogfood mutation control`,
);

await writeFile(sourcePath, mutatedSource);
try {
  const blocked = runCli(2);
  assert.match(blocked, /REPLAY_SAFETY_REGRESSION STALE_ASSERTION/);
  assert.doesNotMatch(blocked, /OUTPUT_MISMATCH|Verified 6 case/);
  assert.deepEqual(await entriesOrEmpty(path.join(root, ".replaylock", "verify")), []);
} finally {
  await writeFile(sourcePath, originalSource);
}

assert.equal(await readFile(sourcePath, "utf8"), originalSource, "mutation control must restore source bytes");
assert.deepEqual(await caseBytes(), originalCases, "blocked replay must not update accepted cases");
console.log("dogfood verified");

function runCli(status) {
  return runNode([cliPath, "verify"], status);
}

function runNode(arguments_, status = 0) {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.ifError(result.error);
  assert.equal(result.status, status, `command failed (${arguments_.slice(0, 2).join(" ")}):\n${output}`);
  return output;
}

async function caseBytes() {
  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      bytes: await readFile(path.join(casesDirectory, filename)),
    })),
  );
}

async function entriesOrEmpty(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
