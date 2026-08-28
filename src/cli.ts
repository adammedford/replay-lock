#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  candidateStates,
  formPendingCandidateStates,
  validateCandidateSessionRecord,
  type CandidateBlock,
} from "./candidates.js";
import { aggregateSession } from "./session.js";
import {
  artifactJson,
  atomicWrite,
  createCandidate,
  isObject,
  parseCandidate,
  parseCase,
  validateSourceDiagnostic,
  type CandidateArtifact,
  type CaseArtifact,
  type Observation,
  type SourceDiagnostic,
} from "./model.js";
import {
  acceptReviewedCandidate,
  compareReviewCandidates,
  describeReplacement,
  formatCandidateReview,
  parseReviewDecision,
  retainAssumptionRefreshCandidates,
} from "./review.js";
import {
  replayAcceptedCases,
  resolveProjectPackageCatalog,
  validateProjectAdapters,
  type AdapterValidation,
  type PackageCatalogResolution,
} from "./project-execution.js";
import {
  preflightAcceptedCases,
  VerificationPreflightError,
} from "./verification.js";
import { preflightRecordingProject, scanProjectEligibility, type ScanStatus } from "./vite-plugin.js";
import { projectLockfileDigest as digestProjectLockfile, readProjectLockfile, type ProjectLockfile } from "./project-lockfile.js";
import { emptyPackageCatalog } from "./package-catalog.js";

async function main(arguments_: string[]): Promise<number> {
  const [command, ...rest] = arguments_;
  switch (command) {
    case "record":
      return record(rest);
    case "review":
      return review();
    case "verify":
      return verify();
    case "scan":
      return scan();
    default:
      printUsage();
      return 2;
  }
}

async function record(arguments_: string[]): Promise<number> {
  const separator = arguments_.indexOf("--");
  const childArguments = separator >= 0 ? arguments_.slice(separator + 1) : [];
  const [childCommand, ...childRest] = childArguments;
  if (!childCommand) {
    console.error("Usage: replaylock record -- <vitest-backed command>");
    return 2;
  }

  const root = process.cwd();
  let lockfile;
  try {
    lockfile = await readProjectLockfile(root);
  } catch (error) {
    console.error(`PROJECT_ANALYSIS_FAILED: ${errorMessage(error)}`);
    return 2;
  }
  const lockfileDigest = digestProjectLockfile(lockfile);

  const catalogResolution = await resolveProjectPackageCatalog(root, "recording");
  if (!catalogResolution.ok) {
    console.error(`${formatPackageCatalogFailure(catalogResolution)}: project trusted-package catalog is invalid`);
    return 2;
  }
  const packageCatalog = catalogResolution.catalog ?? emptyPackageCatalog;

  let recordingPreflight;
  try {
    recordingPreflight = preflightRecordingProject(root, { packageCatalog, lockfile });
  } catch (error) {
    console.error(`PROJECT_ANALYSIS_FAILED: ${errorMessage(error)}`);
    return 2;
  }
  for (const diagnostic of recordingPreflight.diagnostics) {
    printSourceDiagnostic(diagnostic);
  }
  if (recordingPreflight.captureTargets === 0) {
    console.error("NO_CAPTURE_TARGET: no @replaylock capture target was found");
    return 2;
  }
  if (recordingPreflight.eligibleTargets === 0) {
    console.error("NO_ELIGIBLE_TARGET: every capture target was blocked by policy or analysis");
    return 2;
  }
  const adapterConfiguration = (await validateProjectAdapters({
    root,
    environment: "recording",
  }))[0] ?? { ok: false, code: "VALUE_ADAPTER_VALIDATOR_FAILED" as const };
  if (!adapterConfiguration.ok) {
    console.error(`${formatAdapterValidation(adapterConfiguration)}: project adapter configuration is invalid`);
    return 2;
  }

  const sessionDirectory = path.join(
    root,
    ".replaylock",
    "observations",
    "sessions",
    randomUUID(),
  );
  const sessionToken = randomBytes(32).toString("hex");
  const replayFailures: string[] = [];
  let sessionReady = false;
  let sessionUsable = false;

  try {
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    sessionReady = true;
  } catch (error) {
    console.error(`STORE_WRITE_FAILED SESSION_SETUP_FAILED: ${errorMessage(error)}`);
    return 2;
  }

  const environment = recordingEnvironment(sessionReady, sessionDirectory, sessionToken);
  const childStatus = await runChild(childCommand, childRest, environment, "inherit");

  let observations: Observation[] = [];
  let observationBlocks: CandidateBlock[] = [];
  let sourceDiagnostics: SourceDiagnostic[] = [...recordingPreflight.diagnostics];
  let adapterDiagnostics: AdapterDiagnostic[] = [];
  let partialRecording = false;
  if (sessionReady) {
    try {
      adapterDiagnostics = await readAdapterDiagnostics(sessionDirectory, sessionToken);
    } catch (error) {
      replayFailures.push(`SESSION_PARTIAL: ADAPTER_DIAGNOSTIC_READ_FAILED (${errorMessage(error)})`);
    }
    try {
      const handshake = await readJson(path.join(sessionDirectory, "handshake.json"));
      if (!isObject(handshake) || handshake.token !== sessionToken) {
        replayFailures.push("PLUGIN_NOT_ACTIVE: the configured Vite integration did not activate");
      } else {
        const aggregation = aggregateSession(
          sessionDirectory,
          sessionToken,
          validateCandidateSessionRecord,
        );
        observations = aggregation.records
          .filter((record) => record.state === "observation")
          .map((record) => record.observation)
          .filter((observation) => observation.token === sessionToken);
        observationBlocks = aggregation.records
          .filter((record) => record.state === "blocked")
          .map((record) => record.block);
        for (const failure of aggregation.failures) {
          replayFailures.push(
            `${failure.reason === "STORAGE_FAILURE" ? "STORE_WRITE_FAILED " : ""}SESSION_PARTIAL: ${failure.reason}${failure.workerId ? ` (${failure.workerId})` : ""}`,
          );
        }
        partialRecording = aggregation.partial;
        sourceDiagnostics = dedupeSourceDiagnostics([
          ...sourceDiagnostics,
          ...await readSourceDiagnostics(sessionDirectory),
        ]);
        partialRecording ||= sourceDiagnostics.length > 0;
        sessionUsable = true;
      }
    } catch (error) {
      replayFailures.push(`SESSION_PARTIAL: SESSION_AGGREGATION_FAILED (${errorMessage(error)})`);
    }
  }

  for (const diagnostic of sourceDiagnostics) {
    if (!recordingPreflight.diagnostics.some((preflight) =>
      JSON.stringify(preflight) === JSON.stringify(diagnostic))) printSourceDiagnostic(diagnostic);
  }
  for (const diagnostic of adapterDiagnostics) {
    console.error(`${formatAdapterConfigurationDiagnostic(diagnostic.code)}: ${diagnostic.message.replace(/^VALUE_ADAPTER_[A-Z_]+:\s*/, "")}`);
  }
  // Persist eligible observations even when another annotated callable was
  // blocked. A partial session must not discard completed natural calls.
  if (sessionUsable && lockfileDigest) {
    try {
      const adapterValidation = await validateProjectAdapters({
        root,
        documents: observations,
        environment: "recording",
      });
      const retainedObservations: Observation[] = [];
      for (let index = 0; index < observations.length; index += 1) {
        const observation = observations[index];
        const validation = adapterValidation[index];
        if (!observation || !validation) continue;
        if (validation.ok) {
          retainedObservations.push(observation);
        } else {
          console.error(`${formatAdapterValidation(validation)} ${observation.locator.module}#${observation.locator.exportName}`);
          observationBlocks.push({
            code: "VALUE_ADAPTER_BLOCK",
            locator: { ...observation.locator },
            safePath: "$",
          });
        }
      }
      observations = retainedObservations;
      const pendingDirectory = path.join(root, ".replaylock", "observations", "pending");
      await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });
      const acceptedCases = await readAcceptedCases(root);
      const observedCandidates = observations.map((observation) =>
        createCandidate(observation, lockfileDigest, partialRecording ? "partial" : "complete")
      );
      const states = formPendingCandidateStates({
        observations: observedCandidates,
        acceptedCases,
        blocked: observationBlocks,
      });
      const candidates = retainAssumptionRefreshCandidates(
        candidateStates(states),
        observedCandidates,
        acceptedCases,
      );
      const blocks = states
        .filter((state) => state.state === "blocked")
        .map((state) => state.block);
      for (const candidate of candidates) {
        const candidatePath = path.join(pendingDirectory, `${candidate.caseId}.json`);
        await atomicWrite(candidatePath, artifactJson(candidate));
      }
      for (const block of blocks) {
        if (block.code === "OBSERVED_NONDETERMINISM" && block.caseId) {
          await unlinkIfPresent(path.join(pendingDirectory, `${block.caseId}.json`));
        }
        const identity = block.caseId ?? createHash("sha256")
          .update(JSON.stringify(block), "utf8")
          .digest("hex");
        await atomicWrite(
          path.join(root, ".replaylock", "observations", "blocked", `${identity}.json`),
          `${JSON.stringify({ state: "blocked", block }, null, 2)}\n`,
        );
        console.log(`${block.code} ${block.locator.module}#${block.locator.exportName}`);
      }
      console.log(`Recorded ${candidates.length} candidate(s)`);
      if (blocks.length > 0) {
        console.log(`Blocked ${blocks.length} observation(s)`);
      }
    } catch (error) {
      replayFailures.push(`STORE_WRITE_FAILED SESSION_PARTIAL: SESSION_PERSIST_FAILED (${errorMessage(error)})`);
    }
  }

  if (sourceDiagnostics.length > 0) {
    replayFailures.push("SESSION_PARTIAL: one or more annotated callables were blocked");
  }

  for (const failure of replayFailures) {
    console.error(failure);
  }
  if (adapterDiagnostics.length > 0) return 2;
  if (childStatus !== 0) {
    console.error(`Wrapped command exited with status ${childStatus}`);
    return childStatus;
  }
  return replayFailures.length === 0 ? 0 : 2;
}

interface AdapterDiagnostic {
  token: string;
  code: string;
  message: string;
}

async function readAdapterDiagnostics(sessionDirectory: string, token: string): Promise<AdapterDiagnostic[]> {
  const text = await readTextIfPresent(path.join(sessionDirectory, "adapter-diagnostics.jsonl"));
  if (text === undefined) return [];
  const diagnostics = new Map<string, AdapterDiagnostic>();
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const value = JSON.parse(line) as unknown;
    if (!isObject(value) || value.token !== token || typeof value.code !== "string" ||
      !value.code.startsWith("VALUE_ADAPTER_") || typeof value.message !== "string") continue;
    const diagnostic = { token, code: value.code, message: value.message };
    diagnostics.set(`${diagnostic.code}\0${diagnostic.message}`, diagnostic);
  }
  return [...diagnostics.values()].sort((left, right) =>
    compareText(left.code, right.code) || compareText(left.message, right.message));
}

async function readAcceptedCases(root: string): Promise<CaseArtifact[]> {
  const directory = path.join(root, ".replaylock", "cases");
  const cases: CaseArtifact[] = [];
  for (const filename of await jsonFiles(directory)) {
    cases.push(parseCase(await readFile(path.join(directory, filename), "utf8")));
  }
  return cases;
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function recordingEnvironment(
  active: boolean,
  sessionDirectory: string,
  sessionToken: string,
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  if (active) {
    environment.REPLAYLOCK_SESSION_DIR = sessionDirectory;
    environment.REPLAYLOCK_SESSION_TOKEN = sessionToken;
  }
  return environment;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAdapterConfigurationDiagnostic(code: string): string {
  const publicCode = code === "VALUE_ADAPTER_ID_DUPLICATE"
    ? "VALUE_ADAPTER_ID_CONFLICT"
    : code === "VALUE_ADAPTER_PROTOTYPE_DUPLICATE"
      ? "VALUE_ADAPTER_PROTOTYPE_CONFLICT"
      : "VALUE_ADAPTER_INVALID";
  return `${publicCode} ${code}`;
}

function formatAdapterValidation(validation: AdapterValidation): string {
  const code = validation.code ?? "VALUE_ADAPTER_VALIDATOR_FAILED";
  if (validation.detailCode) {
    if (code === "VALUE_ADAPTER_REGISTRY_FAILED") {
      const configured = formatAdapterConfigurationDiagnostic(validation.detailCode);
      const [publicCode, ...details] = configured.split(" ");
      return `${publicCode} ${code} ${details.join(" ")}`;
    }
    return `${code} ${validation.detailCode}`;
  }
  if (code === "VALUE_ADAPTER_CONFIG_LOAD_FAILED" || code === "VALUE_ADAPTER_REGISTRY_FAILED") {
    return `VALUE_ADAPTER_INVALID ${code}`;
  }
  return code;
}

function formatPackageCatalogFailure(resolution: PackageCatalogResolution): string {
  const code = resolution.code ?? "TRUSTED_PACKAGE_REGISTRY_FAILED";
  if (resolution.detailCode) return `TRUSTED_PACKAGE_INVALID ${code} ${resolution.detailCode}`;
  return `TRUSTED_PACKAGE_INVALID ${code}`;
}

function formatUnhandledDiagnostic(error: unknown): string {
  if (
    error instanceof VerificationPreflightError &&
    error.code !== "CASE_SCHEMA_UNSUPPORTED" &&
    error.code !== "ORPHANED_CALLABLE"
  ) {
    return `REPLAY_SAFETY_REGRESSION ${error.message}`;
  }
  return errorMessage(error);
}

async function review(): Promise<number> {
  const root = process.cwd();
  const pendingDirectory = path.join(root, ".replaylock", "observations", "pending");
  const candidates = await Promise.all((await jsonFiles(pendingDirectory)).map(async (filename) => ({
    filename,
    candidate: parseCandidate(await readFile(path.join(pendingDirectory, filename), "utf8")),
  })));
  candidates.sort((left, right) => compareReviewCandidates(left.candidate, right.candidate));
  if (candidates.length === 0) {
    console.log("No pending candidates");
    return 0;
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  const decisions = terminal[Symbol.asyncIterator]();
  try {
    let index = 0;
    while (index < candidates.length) {
      const current = candidates[index]!;
      await printCandidateForReview(root, current);
      stdout.write("[a]ccept, [r]eject, [s]kip, or [af] accept remaining in this file? ");
      const decision = await decisions.next();
      const answer = parseReviewDecision(decision.done ? "" : decision.value);
      if (answer === undefined) {
        console.error(`No review decision recorded; retained ${current.candidate.caseId}`);
        return 2;
      }
      if (answer === "reject") {
        await unlink(path.join(pendingDirectory, current.filename));
        console.log(`Rejected ${current.candidate.caseId}`);
        index += 1;
        continue;
      }
      if (answer === "skip") {
        console.log(`Skipped ${current.candidate.caseId}`);
        index += 1;
        continue;
      }
      await acceptPendingCandidate(root, pendingDirectory, current);
      index += 1;
      if (answer === "accept-remaining-in-file") {
        const module = current.candidate.locator.module;
        while (index < candidates.length && candidates[index]!.candidate.locator.module === module) {
          const next = candidates[index]!;
          await printCandidateForReview(root, next);
          await acceptPendingCandidate(root, pendingDirectory, next);
          index += 1;
        }
      }
    }
  } finally {
    terminal.close();
  }
  return 0;
}

interface PendingReviewEntry {
  filename: string;
  candidate: CandidateArtifact;
}

async function printCandidateForReview(root: string, entry: PendingReviewEntry): Promise<void> {
  console.log(formatCandidateReview(entry.candidate));
  const casePath = path.join(root, ".replaylock", "cases", `${entry.candidate.caseId}.json`);
  const existingText = await readTextIfPresent(casePath);
  if (existingText !== undefined) {
    const replacement = describeReplacement(parseCase(existingText), entry.candidate);
    if (replacement) console.log(replacement.diff);
  }
}

/** The only place `review` promotes a pending candidate into a source-controlled case; a batch accept goes through the exact same per-candidate atomic write as a single one. */
async function acceptPendingCandidate(
  root: string,
  pendingDirectory: string,
  entry: PendingReviewEntry,
): Promise<void> {
  const casePath = path.join(root, ".replaylock", "cases", `${entry.candidate.caseId}.json`);
  let artifact: CaseArtifact;
  try {
    artifact = await acceptReviewedCandidate(casePath, entry.candidate);
  } catch (error) {
    throw new Error(`STORE_WRITE_FAILED CASE_WRITE_FAILED: ${errorMessage(error)}`);
  }
  await unlink(path.join(pendingDirectory, entry.filename));
  console.log(`Accepted ${artifact.caseId}`);
}

/**
 * A read-only, static eligibility report: no session, no Vitest invocation,
 * no writes under `.replaylock/`. Safe to run against a project that has
 * never wired ReplayLock's Vite plugin in at all. Always exits `0`; this is
 * a report, never a gate.
 */
async function scan(): Promise<number> {
  const root = process.cwd();
  let lockfile: ProjectLockfile | undefined;
  try {
    lockfile = await readProjectLockfile(root);
  } catch {
    lockfile = undefined;
  }
  let packageCatalog = emptyPackageCatalog;
  try {
    const catalogResolution = await resolveProjectPackageCatalog(root, "recording");
    if (catalogResolution.ok) packageCatalog = catalogResolution.catalog ?? emptyPackageCatalog;
  } catch {
    // Best-effort: an invalid or unreadable catalog never fails a scan.
  }

  const report = scanProjectEligibility(root, { packageCatalog, ...(lockfile ? { lockfile } : {}) });
  const counts: Record<ScanStatus, number> = {
    eligible: 0,
    "needs-review": 0,
    ineligible: 0,
    "unsupported-shape": 0,
    excluded: 0,
  };
  for (const finding of report.findings) {
    counts[finding.status] += 1;
    console.log(
      `${scanStatusCode(finding.status)} ${finding.source}:${finding.line}:${finding.column}: ${finding.exportName}` +
        `${finding.reasonCode ? ` (${finding.reasonCode})` : ""}`,
    );
  }
  console.log(
    `Scanned ${report.findings.length} exported function(s): ${counts.eligible} eligible, ` +
      `${counts["needs-review"]} needs-review, ${counts.ineligible} ineligible, ` +
      `${counts["unsupported-shape"]} unsupported-shape, ${counts.excluded} excluded`,
  );
  return 0;
}

function scanStatusCode(status: ScanStatus): string {
  switch (status) {
    case "eligible":
      return "SCAN_ELIGIBLE";
    case "needs-review":
      return "SCAN_NEEDS_REVIEW";
    case "ineligible":
      return "SCAN_INELIGIBLE";
    case "unsupported-shape":
      return "SCAN_UNSUPPORTED_SHAPE";
    case "excluded":
      return "SCAN_EXCLUDED";
  }
}

async function verify(): Promise<number> {
  const root = process.cwd();
  const caseDirectory = path.join(root, ".replaylock", "cases");
  const caseFiles = await jsonFiles(caseDirectory);
  if (caseFiles.length === 0) {
    console.log("No accepted cases");
    return 0;
  }

  const caseInputs = await Promise.all(caseFiles.map(async (filename) => ({
    filename,
    text: await readFile(path.join(caseDirectory, filename), "utf8"),
  })));
  const cases = await preflightAcceptedCases(root, caseInputs);
  const adapterValidation = await validateProjectAdapters({
    root,
    documents: cases,
    environment: "replay",
  });
  for (let index = 0; index < cases.length; index += 1) {
    const validation = adapterValidation[index];
    const artifact = cases[index];
    if (validation && !validation.ok && artifact) {
      throw new Error(`${formatAdapterValidation(validation)} ${artifact.locator.module}#${artifact.locator.exportName}`);
    }
  }

  const replay = await replayAcceptedCases({ root, cases });
  if (replay.status === "behavioral-failure") return 1;
  if (replay.status === "infrastructure-failure") {
    if (replay.diagnostic) console.error(replay.diagnostic);
    return 2;
  }
  console.log(`Verified ${replay.count} case(s)`);
  return 0;
}

async function readSourceDiagnostics(sessionDirectory: string): Promise<SourceDiagnostic[]> {
  const sourceDiagnostics = await readSessionJsonLines(
    sessionDirectory,
    "diagnostics-",
    validateSourceDiagnostic,
  );
  const diagnostics = new Map<string, SourceDiagnostic>();
  for (const diagnostic of sourceDiagnostics) {
    diagnostics.set(JSON.stringify(diagnostic), diagnostic);
  }
  return [...diagnostics.values()].sort(compareSourceDiagnostics);
}

async function readSessionJsonLines<T>(
  sessionDirectory: string,
  filenamePrefix: string,
  validate: (value: unknown) => T,
): Promise<T[]> {
  const filenames = (await readdir(sessionDirectory))
    .filter((name) => name.startsWith(filenamePrefix) && name.endsWith(".jsonl"))
    .sort();
  const values: T[] = [];
  for (const filename of filenames) {
    const contents = await readFile(path.join(sessionDirectory, filename), "utf8");
    for (const line of contents.split("\n")) {
      if (line.length === 0) continue;
      values.push(validate(JSON.parse(line) as unknown));
    }
  }
  return values;
}

function compareSourceDiagnostics(left: SourceDiagnostic, right: SourceDiagnostic): number {
  return (
    compareText(left.source, right.source) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
}

function dedupeSourceDiagnostics(values: readonly SourceDiagnostic[]): SourceDiagnostic[] {
  const diagnostics = new Map<string, SourceDiagnostic>();
  for (const diagnostic of values) diagnostics.set(JSON.stringify(diagnostic), diagnostic);
  return [...diagnostics.values()].sort(compareSourceDiagnostics);
}

function printSourceDiagnostic(diagnostic: SourceDiagnostic): void {
  console.error(
    `${diagnostic.code} ${diagnostic.source}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readTextIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function runChild(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  stdio: "inherit",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      stdio,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Wrapped command terminated by ${signal}`);
        resolve(2);
      } else {
        resolve(code ?? 2);
      }
    });
  });
}

function printUsage(): void {
  console.error("Usage: replaylock <record|review|verify|scan>");
}

main(process.argv.slice(2)).then(
  (status) => {
    process.exitCode = status;
  },
  (error: unknown) => {
    console.error(formatUnhandledDiagnostic(error));
    process.exitCode = 2;
  },
);
