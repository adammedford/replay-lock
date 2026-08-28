import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("V1 workflow documentation verified", async () => {
  const [readme, ignore] = await Promise.all([read("README.md"), read(".gitignore")]);
  for (const text of [
    "replaylock record -- vitest run", "replaylock review", "replaylock verify",
    "@replaylock capture", "@replaylock assume-pure <nonempty reason>",
    "@replaylock exclude <nonempty reason>", 'from "replaylock/vite"',
    "plugins: [replaylock()]", "replaylock.config.ts", "defineReplayLock",
    ".replaylock/observations/pending/", ".replaylock/cases/*.json",
    ".replaylock/verify/", ".replaylock/validate/", "## Exit codes",
    "## Stable diagnostics", "PLUGIN_NOT_ACTIVE", "OUTPUT_MISMATCH",
    "REPLAY_SAFETY_REGRESSION", "STORE_WRITE_FAILED", "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED",
    "VALUE_ADAPTER_MISSING", "VALUE_ADAPTER_VERSION_MISMATCH",
    "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH", "INSTRUMENTATION_UNSUPPORTED",
  ]) assert.match(readme, new RegExp(escape(text)), `README must document ${text}`);
  for (const directory of [".replaylock/observations/", ".replaylock/verify/", ".replaylock/validate/"]) {
    assert.match(ignore, new RegExp(`^${escape(directory)}$`, "m"));
  }
  assert.doesNotMatch(ignore, /^\.replaylock\/$/m, "accepted cases must remain committable");
  assert.match(readme, /`0`:[\s\S]*`1`:[\s\S]*`2`:/);
  assert.match(readme, /nonzero wrapped-command status remains the process status/);
});

test("V1 terminology verified", async () => {
  const files = await Promise.all([read("README.md"), read("docs/value-adapters.md"), read("docs/pilot-checklist.md")]);
  const combined = files.join("\n");
  assert.match(combined, /reviewed characterization case/);
  assert.match(combined, /regression case/);
  assert.match(combined, /likely-safe/);
  assert.match(combined, /not proof of purity, determinism, or correctness/);
  assert.match(combined, /intentional unit and integration tests/);
  assert.doesNotMatch(combined, /proves? (?:that )?(?:a callable is )?pure/i);
});

test("V1 privacy guidance verified", async () => {
  const [readme, pilot] = await Promise.all([read("README.md"), read("docs/pilot-checklist.md")]);
  const combined = `${readme}\n${pilot}`;
  assert.match(combined, /only development or test workloads/i);
  assert.match(combined, /Never record production or customer data/);
  assert.match(combined, /human must inspect every[\s\S]*before committing/i);
  assert.match(combined, /defense in depth, not a guarantee/i);
  assert.match(combined, /does not upload source, captured values, cases, or pilot metrics/);
  assert.match(combined, /no telemetry/i);
});

test("adapter trust documentation verified", async () => {
  const adapters = await read("docs/value-adapters.md");
  for (const term of ["synchronous", "deterministic", "side-effect-free", "complete for callable-observable state"]) {
    assert.match(adapters, new RegExp(escape(term), "i"));
  }
  assert.match(adapters, /cannot prove or sandbox/);
  assert.match(adapters, /cannot undo mutation, I\/O, disclosure, or other effects/);
  assert.match(adapters, /false-safe characterization case/);
  assert.match(adapters, /built-in canonical values/);
  assert.match(adapters, /fresh payload/);
  assert.match(adapters, /byte-identical canonical payload/);
  assert.match(adapters, /Registration changes encodability only|not[\s\S]*purity override/i);
});

test("V1 troubleshooting verified", async () => {
  const guide = await read("docs/troubleshooting.md");
  for (const heading of [
    "## Blocked evidence", "## Partial sessions", "## Plugin activation",
    "## Stale assumptions", "## Orphaned callables and policy changes",
    "## Adapter configuration and evolution",
  ]) assert.match(guide, new RegExp(escape(heading)));
  for (const code of ["EFFECT_REFUTED", "UNKNOWN_EFFECT", "SESSION_PARTIAL", "PLUGIN_NOT_ACTIVE", "STALE_ASSERTION", "ORPHANED_CALLABLE"]) {
    assert.match(guide, new RegExp(code));
  }
  assert.match(guide, /accept-new, verify, delete-old workflow/);
  assert.match(guide, /before target invocation/);
});

test("manual telemetry-free pilot verified", async () => {
  const pilot = await read("docs/pilot-checklist.md");
  for (const measure of [
    "Time to first accepted case", "Median review time", "Accepted-candidate rate",
    "Behavior-preserving refactor survival", "Maintenance time", "False-safe findings",
    "Persisted-secret failures", "Unintended regressions caught",
    "Adapter module-loading limitations",
  ]) assert.match(pilot, new RegExp(escape(measure)));
  for (const threshold of ["Under 2 minutes", "At least 30%", "At least 80%", "Exactly 0", "At least 1"]) {
    assert.match(pilot, new RegExp(escape(threshold)));
  }
  assert.match(pilot, /manually/);
  assert.match(pilot, /no telemetry/);
  assert.match(pilot, /do not upload source or captured values/);
  assert.match(pilot, /locked V1 black-box acceptance suite/);
});

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
