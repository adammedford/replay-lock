import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { artifactJson, createCandidate } from "../../dist/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "dist", "cli.js");
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

test("verify blames the exact sibling after skipping a within-epsilon change", async () => {
  await withReviewedCase({ a: 10, b: 20 }, "t\n0\n0.5\n", async (project) => {
    await replayValue(project, { a: 10.25, b: 21 });
    const result = runCli(project, "verify");
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#calculate: \$\.b: expected 20; received 21/);
  });
});

test("verify follows nested array paths past tolerated elements to the failing leaf", async () => {
  await withReviewedCase({ rows: [{ a: 10, b: 20 }, 30] }, "t\n0\n0.5\n", async (project) => {
    await replayValue(project, { rows: [{ a: 10.25, b: 20 }, 31] });
    const result = runCli(project, "verify");
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#calculate: \$\.rows\[1\]: expected 30; received 31/);
  });
});

test("verify uses semantic keys when a dotted record key contains the tolerated array leaf", async () => {
  await withReviewedCase({ "a.b": [10], z: "before" }, "t\n0.5\n", async (project) => {
    await replayValue(project, { "a.b": [10.25], z: "after" });
    const result = runCli(project, "verify");
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#calculate: \$\.z: expected "before"; received "after"/);
  });
});

test("verify renders a failing dotted key as one record key", async () => {
  await withReviewedCase({ a: 10, "b.c": 20 }, "t\n0\n0.5\n", async (project) => {
    await replayValue(project, { a: 10.25, "b.c": 21 });
    const result = runCli(project, "verify");
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#calculate: \$\["b\.c"\]: expected 20; received 21/);
  });
});

test("verify preserves exact diagnostics and the inclusive epsilon boundary", async () => {
  await withReviewedCase({ a: 10, b: 20 }, "t\n0\n0.5\n", async (project) => {
    await replayValue(project, { a: 10.5, b: 20 });
    const boundary = runCli(project, "verify");
    assert.equal(boundary.status, 0, output(boundary));

    await replayValue(project, { a: 10.75, b: 21 });
    const outside = runCli(project, "verify");
    assert.equal(outside.status, 1, output(outside));
    assert.match(output(outside), /\$\.a: expected 10; received 10.75/);
  });

  await withReviewedCase({ a: 10, b: 20 }, "a\n", async (project) => {
    await replayValue(project, { a: 10.25, b: 21 });
    const exact = runCli(project, "verify");
    assert.equal(exact.status, 1, output(exact));
    assert.match(output(exact), /\$\.a: expected 10; received 10.25/);
  });
});

test("verify names structural changes after skipping tolerated values", async () => {
  await withReviewedCase({ a: 10, rows: [20] }, "t\n0\n0.5\n", async (project) => {
    await replayValue(project, { a: 10.25, rows: [20, 30] });
    const length = runCli(project, "verify");
    assert.equal(length.status, 1, output(length));
    assert.match(output(length), /\$\.rows.length: expected 1; received 2/);

    await replayValue(project, { a: 10.25 });
    const missing = runCli(project, "verify");
    assert.equal(missing.status, 1, output(missing));
    assert.match(output(missing), /\$\.rows: expected \[20\]; received <missing>/);

    await replayValue(project, { a: 10.25, rows: [20], z: true });
    const added = runCli(project, "verify");
    assert.equal(added.status, 1, output(added));
    assert.match(output(added), /\$\.z: unexpected value true/);
  });
});

test("verify keeps adapter payload diagnostics exact beside a tolerated leaf", async () => {
  const canonicalValue = {
    kind: "record",
    entries: [
      { key: "a", value: { kind: "number", value: 10 } },
      { key: "z", value: { kind: "adapted", adapterId: "example.money", version: 1,
        payload: { kind: "record", entries: [{ key: "cents", value: { kind: "number", value: 20 } }] } } },
    ],
  };
  await withReviewedCase(canonicalValue, "t\n0.5\n", async (project) => {
    await writeFile(path.join(project, "src", "calculation.ts"), `import { Money } from "./money.js";
/**
 * @replaylock capture
 * @replaylock assume-pure reviewed domain construction
 */
export function calculate() { return { a: 10.25, z: new Money(20.25) }; }
`);
    const result = runCli(project, "verify");
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), /OUTPUT_MISMATCH src\/calculation\.ts#calculate: \$\.z.payload.cents: expected 20; received 20.25/);
  }, { canonical: true, setup: async (project) => {
    await mkdir(path.join(project, "node_modules"));
    await symlink(root, path.join(project, "node_modules", "replaylock"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(project, "src", "money.ts"), "export class Money { constructor(readonly cents: number) {} }\n");
    await writeFile(path.join(project, "replaylock.config.ts"), `import { defineReplayLock, defineValueAdapter } from "replaylock";
import { Money } from "./src/money.js";
export default defineReplayLock({ valueAdapters: [defineValueAdapter({
  type: Money, id: "example.money", version: 1,
  serialize(value: Money) { return { cents: value.cents }; },
  deserialize(payload: { cents: number }) { return new Money(payload.cents); },
})] });
`);
  } });
});

async function withReviewedCase(value, reviewInput, check, options = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "replaylock-tolerance-diagnostics-"));
  try {
    await mkdir(path.join(project, "src"));
    const pending = path.join(project, ".replaylock", "observations", "pending");
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(project, "package.json"), `${JSON.stringify({ name: "diagnostics-fixture", private: true, type: "module" })}\n`);
    await writeFile(path.join(project, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
    await replayValue(project, value);
    await options.setup?.(project);
    const candidate = createCandidate({
      token: "token",
      locator: { module: "src/calculation.ts", exportName: "calculate" },
      arguments: options.canonical ? { kind: "array", items: [] } : [],
      completion: { kind: "return", value },
      sourceGraphDigest: `sha256:${"a".repeat(64)}`,
      runtimeProfile,
    }, `sha256:${"b".repeat(64)}`);
    await writeFile(path.join(pending, `${candidate.caseId}.json`), artifactJson(candidate));
    const reviewed = runCli(project, "review", reviewInput);
    assert.equal(reviewed.status, 0, output(reviewed));
    await check(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

async function replayValue(project, value) {
  await writeFile(path.join(project, "src", "calculation.ts"), `/** @replaylock capture */\nexport function calculate() { return ${JSON.stringify(value)}; }\n`);
}

function runCli(project, command, input) {
  return spawnSync(process.execPath, [cli, command], { cwd: project, encoding: "utf8", input, timeout: 30_000 });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
