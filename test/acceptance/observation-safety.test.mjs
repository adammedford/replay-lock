import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OBSERVATION_LIMITS,
  ObservationSafetyCollector,
  classifyObservation,
  collectSafeObservations,
  formatObservationDiagnostic,
  normalizeSecretKey,
} from "../../dist/observation-safety.js";

const locator = { module: "src/fixture.ts", exportName: "calculate" };
const invocation = (entryArguments, exitArguments = entryArguments, completion = { kind: "return", value: 1 }) => ({
  locator,
  entryArguments,
  exitArguments,
  completion,
});

test("entry and exit snapshots detect full-argument mutation as MUTATED_INPUT", () => {
  const result = classifyObservation(invocation([{ nested: { count: 1 } }], [{ nested: { count: 2 } }]));
  assert.equal(result.safe, false);
  assert.equal(result.code, "MUTATED_INPUT");
});

test("canonical shape and shared depth, node, byte, and pending limits precede candidates", () => {
  assert.deepEqual(DEFAULT_OBSERVATION_LIMITS, {
    maxDepth: 20,
    maxNodes: 10_000,
    maxCanonicalBytes: 256 * 1024,
    maxPendingUnique: 1_000,
    maxProjectUnique: 1_000,
  });
  let deep = 0;
  let value = true;
  while (deep++ < 21) value = { child: value };
  assert.equal(classifyObservation(invocation([value])).code, "OVERSIZED_OBSERVATION");
  const huge = "x".repeat(256 * 1024);
  assert.equal(classifyObservation(invocation([huge])).code, "OVERSIZED_OBSERVATION");
  assert.equal(classifyObservation(invocation([1]), { pendingUnique: 1_000 }).code, "PENDING_LIMIT");
  assert.equal(classifyObservation(invocation([1]), { projectUnique: 1_000 }).code, "PROJECT_LIMIT");
});

test("specified property names and credential-shaped strings produce SENSITIVE_VALUE", () => {
  assert.equal(normalizeSecretKey("client-secret"), "clientsecret");
  const values = [
    { password: "ordinary" }, { "API-Key": "ordinary" }, "-----BEGIN PRIVATE KEY-----",
    "AKIA1234567890ABCDEF", "ghp_1234567890", "sk-1234567890", "sk_live_123",
    "rk_live_123", "xoxb-123", "Basic abc", "Bearer abc",
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature",
  ];
  for (const value of values) {
    const result = classifyObservation(invocation([value]));
    assert.equal(result.safe, false);
    assert.equal(result.code, "SENSITIVE_VALUE");
  }
});

test("safety classification precedes hashing, naming, logging, diagnostics, and persistence", () => {
  const unsafe = classifyObservation(invocation([{ authorization: "Bearer should-not-escape" }]));
  assert.equal(unsafe.safe, false);
  assert.equal("diagnostic" in unsafe, true);
  assert.equal(JSON.stringify(unsafe).includes("should-not-escape"), false);
  const safe = classifyObservation(invocation([{ answer: 42 }]));
  assert.equal(safe.safe, true);
  assert.match(safe.observation.fingerprint, /^[0-9a-f]{64}$/);
});

test("blocked diagnostics expose only callable and redacted structural paths", () => {
  const result = classifyObservation(invocation([{ nested: { password: "do-not-print" } }]));
  assert.equal(result.safe, false);
  assert.equal(result.diagnostic.locator.module, locator.module);
  assert.equal(result.diagnostic.locator.exportName, locator.exportName);
  assert.equal(result.diagnostic.safePath.includes("do-not-print"), false);
  assert.equal(result.diagnostic.safePath.includes("password"), false);
  assert.equal(formatObservationDiagnostic(result.diagnostic).includes("do-not-print"), false);
});

test("every normalized sensitive-key spelling is redacted before diagnostics are built", () => {
  for (const key of ["API Key", "api-key", "API_KEY", "a.p.i key"]) {
    const result = classifyObservation(invocation([{ nested: { [key]: "do-not-print" } }]));
    assert.equal(result.safe, false);
    assert.equal(result.code, "SENSITIVE_VALUE");
    for (const rendered of [result.diagnostic.path, result.diagnostic.safePath, formatObservationDiagnostic(result.diagnostic), JSON.stringify(result)]) {
      assert.equal(rendered.includes(key), false, key);
      assert.equal(rendered.includes("do-not-print"), false, key);
      assert.equal(rendered.includes("<redacted>"), true, key);
    }
  }
});

test("credential near misses stay outside the catalog", () => {
  for (const value of [
    "AKIA123", "AKIB1234567890ABCDEF", "ghz_123456", "github_patx_123456",
    "skx-123456", "s_k-123456", "sx_live_123", "xoxz-123456", "Bearer",
    "eyJhbGciOiJub25lIn0.not-json.signature",
  ]) {
    const result = classifyObservation(invocation([value]));
    assert.equal(result.safe, true, value);
  }
});

test("unsafe invocations are discarded while unrelated safe observations survive", () => {
  const collected = collectSafeObservations([
    invocation([{ password: "blocked" }]),
    invocation([{ answer: 1 }]),
    invocation([{ answer: 2 }]),
  ]);
  assert.equal(collected.blocked.length, 1);
  assert.equal(collected.safe.length, 2);
  const collector = new ObservationSafetyCollector({ maxPendingUnique: 1 });
  assert.equal(collector.observe(invocation([{ answer: 1 }])).safe, true);
  assert.equal(collector.observe(invocation([{ answer: 2 }])).code, "PENDING_LIMIT");
});
