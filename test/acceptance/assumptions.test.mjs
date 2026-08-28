import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { analyzeProjectCallGraph } from "../../dist/call-graph.js";
import {
  checkAssumptionFreshness,
  createAssumptionFingerprint,
  evaluateAssumption,
  invokeWithAssumption,
  refreshAssumption,
  reviewAssumption,
} from "../../dist/assumptions.js";
import { readProjectLockfile, selectProjectLockfile } from "../../dist/project-lockfile.js";

const modules = {
  "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { return opaque(value); }',
};
const analysis = () => analyzeProjectCallGraph({ modules, entryModule: "entry.ts", exportName: "root" });
const fingerprintInput = (extra = {}) => ({
  modules,
  reachableModules: ["entry.ts"],
  lockfileName: "package-lock.json",
  lockfileBytes: '{"name":"fixture","lockfileVersion":3}',
  unknownEvidence: analysis().findings,
  ...extra,
});

test("unknown targets without assumptions are blocked with UNKNOWN_EFFECT", () => {
  const result = evaluateAssumption(analysis());
  assert.equal(result.verdict, "unknown");
  assert.equal(result.code, "UNKNOWN_EFFECT");
  console.log("unknown effect blocking verified");
});

test("nonempty assumptions resolve only unknown evidence and conflicts fail with ASSERTION_CONFLICT", () => {
  const current = analysis();
  const assumption = reviewAssumption("opaque package is deterministic for numeric input", current, fingerprintInput());
  assert.equal(evaluateAssumption(current, assumption).verdict, "likely-safe");

  // A direct effect is a conflict even if unknown evidence remains. Keep this
  // assertion library-level so assumptions cannot become a source annotation.
  const conflictAnalysis = analyzeProjectCallGraph({
    modules: { "entry.ts": 'import { opaque } from "opaque-package"; export function root(value: number) { console.log(value); return opaque(value); }' },
    entryModule: "entry.ts",
    exportName: "root",
  });
  assert.equal(conflictAnalysis.verdict, "refuted");
  assert.equal(evaluateAssumption(conflictAnalysis, assumption).code, "ASSERTION_CONFLICT");
  console.log("assertion conflict handling verified");
});

test("assumptions cannot resolve unrelated unknown evidence", () => {
  const sourceA = analysis();
  const assumption = reviewAssumption("reviewed package boundary", sourceA, fingerprintInput());
  const sourceB = analyzeProjectCallGraph({
    modules: { "entry.ts": 'import { missing } from "./missing"; export function root(value: number) { return missing(value); }' },
    entryModule: "entry.ts",
    exportName: "root",
  });
  const result = evaluateAssumption(sourceB, assumption);
  assert.equal(result.verdict, "unknown");
  assert.equal(result.code, "UNKNOWN_EFFECT");
});

test("review and accepted provenance retain reason and original sorted evidence", () => {
  const current = analysis();
  const assumption = reviewAssumption("reviewed package boundary", current, fingerprintInput());
  assert.equal(assumption.reason, "reviewed package boundary");
  assert.deepEqual(assumption.evidence, assumption.provenance.originalEvidence);
  assert.deepEqual(assumption.evidence, [...assumption.evidence].sort((a, b) =>
    a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)));
  assert.equal(evaluateAssumption(current, assumption).assumption?.provenance.reason, "reviewed package boundary");
  console.log("assumption provenance verified");
});

test("assumption fingerprints cover modules, one lockfile, evidence, analyzer, and intrinsic catalog", () => {
  const base = createAssumptionFingerprint(fingerprintInput());
  for (const extra of [
    { modules: { ...modules, "helper.ts": "export const value = 1;" }, reachableModules: ["entry.ts", "helper.ts"] },
    { lockfileBytes: '{"name":"fixture","lockfileVersion":4}' },
    { unknownEvidence: [...analysis().findings, { code: "UNKNOWN_CALL", source: "entry.ts", line: 2, column: 1, message: "other" }] },
    { analyzerVersion: "changed" },
    { intrinsicCatalogVersion: "changed" },
  ]) assert.notEqual(createAssumptionFingerprint({ ...fingerprintInput(), ...extra }), base);
  console.log("assumption fingerprint verified");
});

test("explicit lockfile paths require the project root and stay inside it", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "replaylock-assumption-"));
  const projectRoot = path.join(temporaryRoot, "project");
  const outsideRoot = path.join(temporaryRoot, "outside");
  mkdirSync(projectRoot);
  mkdirSync(outsideRoot);
  const projectLockfile = path.join(projectRoot, "package-lock.json");
  const outsideLockfile = path.join(outsideRoot, "package-lock.json");
  writeFileSync(projectLockfile, "project lockfile");
  writeFileSync(outsideLockfile, "outside lockfile");
  assert.throws(
    () => createAssumptionFingerprint({ ...fingerprintInput(), lockfileBytes: undefined, lockfilePath: projectLockfile }),
    /projectRoot is required with lockfilePath/,
  );
  assert.throws(
    () => createAssumptionFingerprint({ ...fingerprintInput(), lockfileBytes: undefined, projectRoot, lockfilePath: outsideLockfile }),
    /lockfile must be at the project root/,
  );
});

test("all provenance callers enforce the same exactly-one lockfile selection", async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), "replaylock-lockfile-"));
  writeFileSync(path.join(projectRoot, "package-lock.json"), "npm");
  writeFileSync(path.join(projectRoot, "yarn.lock"), "yarn");
  const expected = /ReplayLock requires exactly one supported project lockfile \(package-lock\.json, yarn\.lock\)/;
  assert.throws(() => selectProjectLockfile({ projectRoot }), expected);
  await assert.rejects(readProjectLockfile(projectRoot), expected);
});

test("fingerprint changes produce STALE_ASSERTION before invocation", () => {
  const current = analysis();
  const assumption = reviewAssumption("reviewed package boundary", current, fingerprintInput());
  const changed = fingerprintInput({ modules: { "entry.ts": `${modules["entry.ts"]}\nexport const changed = 1;` } });
  assert.equal(checkAssumptionFreshness(assumption, changed).code, "STALE_ASSERTION");
  let invoked = false;
  assert.throws(() => invokeWithAssumption(assumption, changed, () => { invoked = true; }), /STALE_ASSERTION/);
  assert.equal(invoked, false);
  console.log("stale assertion preflight verified");
});

test("refresh requires a new recording and explicit review", () => {
  const current = analysis();
  const assumption = reviewAssumption("initial review", current, fingerprintInput());
  assert.throws(() => refreshAssumption({ previous: assumption, recording: current, fingerprint: fingerprintInput(), reviewed: false }), /explicit review/);
  const refreshed = refreshAssumption({
    previous: assumption,
    recording: current,
    fingerprint: fingerprintInput({ lockfileBytes: '{"name":"fixture","lockfileVersion":4}' }),
    reason: "fresh recording confirms package boundary",
    reviewed: true,
  });
  assert.equal(refreshed.reason, "fresh recording confirms package boundary");
  assert.notEqual(refreshed.fingerprint, assumption.fingerprint);
  console.log("explicit assumption refresh verified");
});
