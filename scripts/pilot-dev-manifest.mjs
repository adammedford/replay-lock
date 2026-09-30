import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const BASELINE_SHA256 = "54ef6aa5b986788844f9c6377a4fdd0b48bdccb1937600537f76ab5ec9801627";
export const PILOTS = Object.freeze([
  Object.freeze({ id: "homer", repository: "https://github.com/bastienwirtz/homer.git", revision: "daa017dfe1ea8d0875697aede091319b6134bb4b", realm: "browser", manager: "pnpm", managerVersion: "11.9.0", lockfile: "pnpm-lock.yaml", config: "vite.config.js", workflows: ["bundled-dashboard", "service-filter", "local-dummy-service"] }),
  Object.freeze({ id: "epic-stack", repository: "https://github.com/epicweb-dev/epic-stack.git", revision: "8473afd804b66dba6a23f317908dc35d1535e90d", realm: "node", manager: "npm", managerVersion: "11.5.2", lockfile: "package-lock.json", config: "vite.config.ts", workflows: ["seeded-user-search", "missing-user-search", "profile-navigation", "notes-navigation"] }),
]);
export const STAGES = ["checkout", "install", "scan", "record", "workload", "review", "offlineReplay", "refactorReplay", "regression"];
export const COUNT_KEYS = ["eligibleNode", "eligibleBrowser", "excludedNode", "excludedBrowser", "observations", "candidates", "accepted", "replayed", "refactorSurvived", "regressionsDetected"];
/** Schema 2 adds a mutation stage after regression: bounded logic mutants per accepted callable, each verified alone. */
export const PILOT_SCHEMA_VERSION = 2;
export const MUTANT_LIMIT = 12;
export const MUTANT_KINDS = ["comparison", "logical", "branch", "string", "number"];
export const MISMATCH_CODES = ["OUTPUT_MISMATCH", "TRACE_MISMATCH", "EFFECT_TRACE_MISMATCH"];
export const stagesFor = schemaVersion => schemaVersion >= 2 ? [...STAGES, "mutation"] : STAGES;
export const countKeysFor = schemaVersion => schemaVersion >= 2 ? [...COUNT_KEYS, "mutantsApplied", "mutantsDetected"] : COUNT_KEYS;
export const sha256 = value => createHash("sha256").update(value).digest("hex");

/** Read the public CLI output, checking its summary against actual finding rows. */
export function parseScan(text) {
  const result = {};
  for (const realm of ["node", "browser"]) {
    const summaries = [...text.matchAll(new RegExp(`^Scanned ${realm}: (\\d+) eligible, (\\d+) skipped findings$`, "gm"))];
    assert.equal(summaries.length, 1, `missing or duplicate ${realm} scan summary`);
    const eligible = [...text.matchAll(new RegExp(`^SCAN_ELIGIBLE ${realm} .+$`, "gm"))].length;
    const excluded = [...text.matchAll(new RegExp(`^SCAN_SKIPPED ${realm} .+$`, "gm"))].length;
    assert.equal(eligible, Number(summaries[0][1]), `${realm} eligible summary disagrees with findings`);
    assert.equal(excluded, Number(summaries[0][2]), `${realm} excluded summary disagrees with findings`);
    result[realm] = { eligible, excluded };
  }
  return result;
}

const object = (value, label) => assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
const text = (value, label) => assert.ok(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty text`);
const digest = (value, label) => assert.match(value ?? "", /^[a-f0-9]{64}$/, `${label} must be SHA256`);
const count = (value, label) => assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer`);
const time = (value, label) => { text(value, label); assert.ok(Number.isFinite(Date.parse(value)), `${label} must be a timestamp`); };

/** Validate evidence relationships, never infer capture success from a runner's exit 0. */
export function validatePilotReport(report, { requireBoth = true } = {}) {
  object(report, "report");
  assert.ok([1, PILOT_SCHEMA_VERSION].includes(report.schemaVersion), "unsupported pilot schema");
  const stages = stagesFor(report.schemaVersion), countKeys = countKeysFor(report.schemaVersion);
  assert.ok(["baseline", "final"].includes(report.phase), "invalid phase");
  time(report.generatedAt, "generatedAt");
  digest(report.runnerSha256, "runnerSha256");
  digest(report.manifestSha256, "manifestSha256");
  object(report.environment, "environment");
  for (const key of ["node", "platform", "arch", "timezone", "locale"]) text(report.environment[key], `environment.${key}`);
  assert.match(report.environment.node, /^22\./, "pilot must use Node 22");
  object(report.replaylock, "replaylock");
  digest(report.replaylock.tarballSha256, "tarball digest");
  if (report.phase === "baseline") assert.equal(report.replaylock.tarballSha256, BASELINE_SHA256, "incorrect baseline artifact");
  assert.ok(Array.isArray(report.pilots) && report.pilots.length > 0, "missing pilots");
  const ids = new Set();
  for (const pilot of report.pilots) {
    object(pilot, "pilot");
    const pin = PILOTS.find(item => item.id === pilot.id);
    assert.ok(pin && !ids.has(pilot.id), "unknown or duplicate pilot");
    ids.add(pilot.id);
    assert.equal(pilot.repository, pin.repository, "repository must be the pinned public application");
    assert.equal(pilot.revision, pin.revision, "revision drift");
    assert.equal(pilot.realm, pin.realm, "incorrect realm");
    assert.ok(["passed", "blocked"].includes(pilot.status), "invalid pilot outcome");
    time(pilot.startedAt, "startedAt"); time(pilot.finishedAt, "finishedAt");
    assert.ok(Date.parse(pilot.finishedAt) >= Date.parse(pilot.startedAt), "reversed timestamps");
    assert.ok(Number.isFinite(pilot.durationMs) && pilot.durationMs >= 0, "invalid duration");
    assert.equal(pilot.data, "synthetic-local", "public pilots require synthetic local data");
    assert.equal(pilot.humanReviewMs, null, "no human review time was measured");
    assert.equal(pilot.reviewMode, "scripted-synthetic-only", "review mode must disclose scripted decisions");
    object(pilot.packageManager, "packageManager");
    assert.equal(pilot.packageManager.name, pin.manager, "wrong package manager");
    assert.equal(pilot.packageManager.version, pin.managerVersion, "package manager version drift");
    object(pilot.source, "source");
    object(pilot.stages, "stages");
    object(pilot.counts, "counts");
    assert.deepEqual(Object.keys(pilot.counts).sort(), [...countKeys].sort(), "missing or unknown counts");
    for (const key of countKeys) if (pilot.counts[key] !== null) count(pilot.counts[key], key);
    assert.ok(Array.isArray(pilot.commands), "commands must be recorded");
    const commands = new Map();
    for (const command of pilot.commands) {
      count(command.id, "command id"); assert.ok(!commands.has(command.id), "duplicate command id");
      commands.set(command.id, command);
      assert.ok(Array.isArray(command.argv) && command.argv.length > 0 && command.argv.every(arg => typeof arg === "string"), "missing command argv");
      text(command.cwd, "command cwd");
      assert.ok(command.exitCode === null || Number.isInteger(command.exitCode), "invalid exit code");
      assert.ok(command.signal === null || typeof command.signal === "string", "invalid signal");
      assert.ok(command.errorCode === null || typeof command.errorCode === "string", "invalid execution error");
      assert.ok(Number.isFinite(command.durationMs) && command.durationMs >= 0, "invalid command duration");
      digest(command.outputSha256, "command output digest"); count(command.outputBytes, "output bytes");
      assert.ok(typeof command.excerpt === "string" && command.excerpt.length <= 6000, "invalid bounded command excerpt");
    }
    for (const stage of stages) {
      const evidence = pilot.stages[stage]; object(evidence, stage);
      assert.ok(["passed", "failed", "not-run"].includes(evidence.status), `invalid ${stage} status`);
      if (evidence.status === "not-run") { assert.equal(evidence.commandId, null, `unrun ${stage} has command evidence`); continue; }
      const command = commands.get(evidence.commandId); assert.ok(command, `missing command evidence for ${stage}`);
      if (evidence.status === "passed") {
        // A mutation stage's command is its last mutant's verify: exit 1 when detected, 0 when it survived.
        if (stage === "mutation") assert.ok([0, 1].includes(command.exitCode), "mutation requires an observed verify exit");
        else assert.equal(command.exitCode, stage === "regression" ? 1 : 0, `${stage} requires successful observed exit`);
        assert.equal(command.signal, null, `${stage} was signaled`); assert.equal(command.errorCode, null, `${stage} did not execute`);
      }
    }
    if (pilot.stages.checkout.status === "passed") {
      assert.equal(pilot.source.verifiedRevision, pin.revision, "checkout revision was not verified");
      digest(pilot.source.packageJsonSha256, "source package digest");
      assert.equal(pilot.source.lockfile, pin.lockfile, "wrong source lockfile");
      digest(pilot.source.lockfileSha256, "source lock digest");
      assert.equal(pilot.source.packageJsonAfterSha256, pilot.source.packageJsonSha256, "application package changed");
      assert.equal(pilot.source.lockfileAfterSha256, pilot.source.lockfileSha256, "application dependency versions changed");
    }
    if (pilot.stages.install.status === "passed") {
      digest(pilot.installedReplaylockSha256, "installed tarball evidence");
      assert.equal(pilot.installedReplaylockSha256, report.replaylock.tarballSha256, "wrong installed package");
    }
    if (pilot.stages.scan.status === "passed") {
      const scan = parseScan(pilot.scanOutput);
      for (const [realm, suffix] of [["node", "Node"], ["browser", "Browser"]]) {
        assert.equal(pilot.counts[`eligible${suffix}`], scan[realm].eligible, "eligible evidence disagrees");
        assert.equal(pilot.counts[`excluded${suffix}`], scan[realm].excluded, "excluded evidence disagrees");
      }
    } else for (const key of ["eligibleNode", "eligibleBrowser", "excludedNode", "excludedBrowser"]) assert.equal(pilot.counts[key], null, "unmeasured scan count");
    assert.ok(Array.isArray(pilot.workflows), "missing workflow observations");
    const workflowIds = new Set();
    for (const workflow of pilot.workflows) {
      assert.ok(pin.workflows.includes(workflow.id) && !workflowIds.has(workflow.id), "unknown or duplicate workflow");
      workflowIds.add(workflow.id); assert.equal(workflow.status, "passed", "only completed workflow observations may be listed");
      text(workflow.assertion, "workflow assertion");
    }
    if (pilot.stages.workload.status === "passed") assert.deepEqual([...workflowIds].sort(), [...pin.workflows].sort(), "incomplete application workflow");
    if (pilot.stages.record.status !== "passed") {
      for (const key of ["observations", "candidates"]) assert.ok(pilot.counts[key] === null || pilot.counts[key] === 0, "failed capture claimed observations");
    }
    for (const [stage, key] of [["review", "accepted"], ["offlineReplay", "replayed"], ["refactorReplay", "refactorSurvived"], ["regression", "regressionsDetected"]]) {
      if (pilot.stages[stage].status === "passed") assert.ok(pilot.counts[key] > 0, `${stage} needs measured positive evidence`);
      else assert.ok(pilot.counts[key] === null || pilot.counts[key] === 0, `unperformed ${stage} claimed success`);
    }
    if (pilot.counts.accepted !== null) assert.ok(pilot.counts.accepted <= (pilot.counts.candidates ?? 0), "accepted more than captured");
    if (pilot.counts.replayed !== null) assert.ok(pilot.counts.replayed <= (pilot.counts.accepted ?? 0), "replayed more than accepted");
    if (pilot.counts.refactorSurvived !== null) assert.ok(pilot.counts.refactorSurvived <= (pilot.counts.replayed ?? 0), "refactor count exceeds replay");
    if (report.schemaVersion >= 2) validateMutation(pilot, commands);
    if (pilot.status === "passed") {
      assert.equal(pilot.blocker, null, "passing pilot has blocker");
      for (const stage of stages) assert.equal(pilot.stages[stage].status, "passed", `passing pilot did not complete ${stage}`);
      assert.equal(pilot.offline, true, "replay was not offline");
      assert.ok(pilot.regressionCodes.includes("OUTPUT_MISMATCH"), "seeded regression lacked output mismatch");
    } else {
      object(pilot.blocker, "blocker");
      assert.ok(stages.includes(pilot.blocker.stage), "invalid blocker stage");
      text(pilot.blocker.code, "blocker code"); text(pilot.blocker.detail, "blocker detail");
      assert.equal(pilot.stages[pilot.blocker.stage].status, "failed", "blocker stage must be failed");
      assert.equal(pilot.blocker.commandId, pilot.stages[pilot.blocker.stage].commandId, "blocker evidence mismatch");
      assert.ok(["transport", "prerequisite", "compatibility", "workflow"].includes(pilot.blocker.category), "invalid blocker category");
      assert.ok(stages.some(stage => pilot.stages[stage].status !== "passed"), "blocked pilot claims full journey");
    }
  }
  if (requireBoth) assert.deepEqual([...ids].sort(), PILOTS.map(pilot => pilot.id).sort(), "both public pilots are required");
  return report;
}

/**
 * Mutation evidence: every mutant is one verify command. A detected mutant
 * exited 1 with a mismatch diagnostic; a survivor exited 0. Per-callable and
 * summary counts must agree with the mutants listed.
 */
function validateMutation(pilot, commands) {
  const stage = pilot.stages.mutation;
  if (stage.status !== "passed") {
    assert.equal(pilot.mutation, null, "unperformed mutation stage claimed results");
    for (const key of ["mutantsApplied", "mutantsDetected"]) assert.ok(pilot.counts[key] === null || pilot.counts[key] === 0, "unperformed mutation claimed counts");
    return;
  }
  assert.equal(pilot.stages.regression.status, "passed", "mutation measured before regression passed");
  object(pilot.mutation, "mutation");
  count(pilot.mutation.limit, "mutant limit");
  assert.ok(Array.isArray(pilot.mutation.callables) && pilot.mutation.callables.length > 0, "passed mutation stage measured no callables");
  let applied = 0, detected = 0, cases = 0;
  const callables = new Set(), mutantCommands = new Set();
  const stageCommands = new Set(Object.entries(pilot.stages).filter(([name]) => name !== "mutation").map(([, evidence]) => evidence.commandId));
  for (const entry of pilot.mutation.callables) {
    object(entry, "mutation callable");
    text(entry.callable, "callable"); assert.ok(!callables.has(entry.callable), "duplicate callable"); callables.add(entry.callable);
    count(entry.cases, "callable cases"); assert.ok(entry.cases > 0, "callable without accepted cases"); cases += entry.cases;
    for (const key of ["generated", "applied", "detected"]) count(entry[key], key);
    assert.ok(Array.isArray(entry.mutants), "mutants must be listed");
    assert.equal(entry.applied, entry.mutants.length, "applied count disagrees with mutants");
    assert.ok(entry.applied <= entry.generated, "more mutants applied than generated");
    assert.ok(entry.applied <= pilot.mutation.limit, "mutants applied beyond the bound");
    assert.equal(entry.detected, entry.mutants.filter(mutant => mutant.detected).length, "detected count disagrees with mutants");
    for (const mutant of entry.mutants) {
      object(mutant, "mutant");
      assert.ok(MUTANT_KINDS.includes(mutant.kind), "unknown mutant kind");
      count(mutant.line, "mutant line"); count(mutant.column, "mutant column"); text(mutant.before, "mutant before"); text(mutant.after, "mutant after");
      assert.equal(typeof mutant.detected, "boolean", "mutant detection must be boolean");
      assert.ok(Array.isArray(mutant.codes) && mutant.codes.every(code => MISMATCH_CODES.includes(code)), "mutant codes must be mismatch diagnostics");
      const command = commands.get(mutant.commandId); assert.ok(command, "missing command evidence for mutant");
      assert.ok(!mutantCommands.has(mutant.commandId) && !stageCommands.has(mutant.commandId), "mutant verify must be its own command"); mutantCommands.add(mutant.commandId);
      assert.equal(command.signal, null, "mutant verify was signaled"); assert.equal(command.errorCode, null, "mutant verify did not execute");
      if (mutant.detected) { assert.equal(command.exitCode, 1, "detected mutant requires a failed verify"); assert.ok(mutant.codes.length > 0, "detected mutant lacks a mismatch code"); }
      else { assert.equal(command.exitCode, 0, "undetected mutant requires a passing verify"); assert.equal(mutant.codes.length, 0, "surviving mutant reported a mismatch"); }
    }
    applied += entry.applied; detected += entry.detected;
  }
  assert.ok(mutantCommands.has(stage.commandId), "mutation stage evidence must be one of its mutants' commands");
  assert.equal(cases, pilot.counts.accepted, "every accepted case must belong to exactly one measured callable");
  assert.equal(pilot.counts.mutantsApplied, applied, "mutantsApplied disagrees with callables");
  assert.equal(pilot.counts.mutantsDetected, detected, "mutantsDetected disagrees with callables");
}
