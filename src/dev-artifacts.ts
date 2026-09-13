import { createHash } from "node:crypto";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { types } from "node:util";
import type { DevBlock, DevCandidate, DevCase, DevEnvironment, DevLocator, DevObservation, DevRetentionPolicy, DevRuntimeProfile, DevValue, TraceEvent } from "./dev-contract.js";
import type { DevRetentionSnapshot } from "./dev-retention.js";
import { assertDevSafe, validateDevValue } from "./dev-values.js";
import { atomicWrite } from "./model.js";
import { parseReviewDecision, parseToleranceEpsilon } from "./review.js";

export const DEV_ARTIFACT_LIMITS = Object.freeze({ maxBytes: 256 * 1024, maxTraceEvents: 10_000, maxPendingUnique: 1_000, maxProjectUnique: 1_000 });
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{64}$/;
const operations = new Set(["Math.random", "crypto.randomUUID", "Date.now", "Date", "new Date", "performance.now", "fetch", "Response.json", "Response.text", "Response.arrayBuffer", "fs.readFileSync", "fs.readFile", "process.env", "import.meta.env"]);

function fail(code = "CASE_SCHEMA_UNSUPPORTED"): never {
  throw Object.assign(new Error(code), { code });
}

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const object = value as Record<string, unknown>;
  if (Reflect.ownKeys(object).some((key) => typeof key !== "string") || Object.values(Object.getOwnPropertyDescriptors(object)).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable)) fail();
  if (required.some((key) => !Object.hasOwn(object, key)) || Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key))) fail();
  return object;
}

function nonempty(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function locator(value: unknown): DevLocator {
  const input = record(value, ["module", "kind", "namePath"]);
  if (!nonempty(input.module) || input.module.includes("\\") || input.module.includes(":") || input.module.startsWith("/") || input.module.split("/").some((part) => !part || part === "." || part === "..") || !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(input.module)) fail();
  if (!["export", "local", "nested"].includes(String(input.kind)) || !Array.isArray(input.namePath) || !input.namePath.length || input.namePath.length > 20 || !input.namePath.every((name) => nonempty(name, 256))) fail();
  if (input.kind !== "nested" && input.namePath.length !== 1) fail();
  return { module: input.module, kind: input.kind as DevLocator["kind"], namePath: [...input.namePath] as string[] };
}

function environment(value: unknown): DevEnvironment {
  if (value !== "node" && value !== "browser") fail();
  return value;
}

function valueNode(value: unknown): DevValue {
  return validateDevValue(value);
}

function traceEvents(value: unknown): TraceEvent[] {
  if (!Array.isArray(value)) fail();
  if (value.length > DEV_ARTIFACT_LIMITS.maxTraceEvents) fail("OVERSIZED_OBSERVATION");
  let previousId = -1;
  const pending = new Set<number>();
  const events: TraceEvent[] = [];
  for (const entry of value) {
    const event = record(entry, ["kind", "id"], ["operation", "arguments", "value"]);
    if (!Number.isSafeInteger(event.id) || (event.id as number) < 0) fail();
    const id = event.id as number;
    if (event.kind === "call") {
      record(event, ["kind", "id", "operation", "arguments"]);
      if (typeof event.operation !== "string" || !operations.has(event.operation) || id !== previousId + 1) fail();
      const args = valueNode(event.arguments);
      if (args.kind !== "array") fail();
      previousId = id;
      pending.add(id);
      events.push({ kind: "call", id, operation: event.operation, arguments: args });
    } else {
      record(event, ["kind", "id", "value"]);
      if ((event.kind !== "return" && event.kind !== "throw") || !pending.delete(id)) fail();
      events.push({ kind: event.kind, id, value: valueNode(event.value) });
    }
  }
  if (pending.size) fail("INCOMPLETE_OBSERVATION");
  return events;
}

function profile(value: unknown, realm: DevEnvironment): DevRuntimeProfile {
  const input = record(value, ["environment", "runtime", "timezone", "locale"]);
  if (input.environment !== realm || !nonempty(input.runtime) || !nonempty(input.timezone) || !nonempty(input.locale)) fail();
  try { new Intl.DateTimeFormat(input.locale, { timeZone: input.timezone }); } catch { fail(); }
  return { environment: realm, runtime: input.runtime, timezone: input.timezone, locale: input.locale };
}

/** Stable JSON also makes identity independent of JSON object property order. */
export function devArtifactJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  }, 2) + "\n";
}

export function createDevCaseId(input: Pick<DevCase, "locator" | "environment" | "arguments" | "trace">): string {
  return createHash("sha256").update(devArtifactJson({ schemaVersion: 2, locator: input.locator, environment: input.environment, arguments: input.arguments, trace: input.trace })).digest("hex");
}

export function createDevCallableId(input: Pick<DevCase, "locator" | "environment">): string {
  return createHash("sha256").update(devArtifactJson({ locator: input.locator, environment: input.environment })).digest("hex");
}

/** Presentation/admission identity only: exact case identities retain every recorded trace value. */
export function createDevGroupId(input: Pick<DevCase, "locator" | "environment" | "arguments" | "trace">): string {
  const trace = input.trace.map(event => event.kind === "call"
    ? { kind: event.kind, id: event.id, operation: event.operation }
    : { kind: event.kind, id: event.id });
  return createHash("sha256").update(devArtifactJson({ locator: input.locator, environment: input.environment, arguments: input.arguments, trace })).digest("hex");
}

function parseDocument(text: string): unknown {
  if (Buffer.byteLength(text) > DEV_ARTIFACT_LIMITS.maxBytes) fail("OVERSIZED_OBSERVATION");
  try { return JSON.parse(text) as unknown; } catch { fail(); }
}

export function parseDevCase(text: string): DevCase {
  const input = record(parseDocument(text), ["schemaVersion", "caseId", "locator", "environment", "arguments", "trace", "completion", "comparison", "eligibility", "provenance"]);
  if (input.schemaVersion !== 2 || typeof input.caseId !== "string" || !idPattern.test(input.caseId)) fail();
  const target = locator(input.locator);
  const realm = environment(input.environment);
  const args = valueNode(input.arguments);
  if (args.kind !== "array") fail();
  const trace = traceEvents(input.trace);
  const completion = record(input.completion, ["kind", "value"]);
  if (completion.kind !== "return" && completion.kind !== "throw") fail();
  let comparison: DevCase["comparison"] = "exact";
  if (input.comparison !== "exact") {
    const tolerance = record(input.comparison, ["kind", "epsilon"]);
    if (tolerance.kind !== "tolerance" || typeof tolerance.epsilon !== "number" || !Number.isFinite(tolerance.epsilon) || tolerance.epsilon <= 0) fail();
    comparison = { kind: "tolerance", epsilon: tolerance.epsilon };
  }
  const eligibility = record(input.eligibility, ["verdict", "reasonCodes"]);
  if (eligibility.verdict !== "replayable" || !Array.isArray(eligibility.reasonCodes) || !eligibility.reasonCodes.length || !eligibility.reasonCodes.every((code) => typeof code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(code)) || new Set(eligibility.reasonCodes).size !== eligibility.reasonCodes.length) fail();
  const provenance = record(input.provenance, ["sourceGraphDigest", "lockfileDigest", "runtimeProfile", "captureStatus"]);
  if (typeof provenance.sourceGraphDigest !== "string" || !digestPattern.test(provenance.sourceGraphDigest) || typeof provenance.lockfileDigest !== "string" || !digestPattern.test(provenance.lockfileDigest) || (provenance.captureStatus !== "complete" && provenance.captureStatus !== "partial")) fail();
  const artifact: DevCase = {
    schemaVersion: 2, caseId: input.caseId, locator: target, environment: realm, arguments: args, trace,
    completion: { kind: completion.kind, value: valueNode(completion.value) }, comparison,
    eligibility: { verdict: "replayable", reasonCodes: [...eligibility.reasonCodes] as string[] },
    provenance: { sourceGraphDigest: provenance.sourceGraphDigest, lockfileDigest: provenance.lockfileDigest, runtimeProfile: profile(provenance.runtimeProfile, realm), captureStatus: provenance.captureStatus },
  };
  assertDevSafe({ locator: artifact.locator, provenance: artifact.provenance, eligibility: artifact.eligibility });
  if (artifact.caseId !== createDevCaseId(artifact)) fail("CASE_ID_MISMATCH");
  return artifact;
}

export function parseDevCandidate(text: string): DevCandidate {
  const input = record(parseDocument(text), ["schemaVersion", "caseId", "locator", "environment", "arguments", "trace", "completion", "comparison", "eligibility", "provenance", "occurrences"], ["replacesCaseId"]);
  const { occurrences, replacesCaseId, ...base } = input;
  if (!Number.isSafeInteger(occurrences) || (occurrences as number) < 1 || input.comparison !== "exact" || (replacesCaseId !== undefined && replacesCaseId !== input.caseId)) fail();
  return { ...parseDevCase(JSON.stringify(base)), occurrences: occurrences as number, ...(replacesCaseId === undefined ? {} : { replacesCaseId: replacesCaseId as string }) };
}

export function toDevCase(candidate: DevCandidate): DevCase {
  const { occurrences: _occurrences, replacesCaseId: _replacement, ...artifact } = candidate;
  return parseDevCase(JSON.stringify(artifact));
}

export function createDevCandidate(observation: DevObservation, lockfileDigest: string, runtimeProfile: DevRuntimeProfile, captureStatus: "complete" | "partial" = "complete"): DevCandidate {
  record(observation, ["locator", "environment", "arguments", "trace", "completion", "sourceGraphDigest", "generation"]);
  if (!nonempty(observation.generation)) fail();
  // Privacy and shape validation precede hashing or filenames.
  const target = locator(observation.locator);
  const realm = environment(observation.environment);
  const args = valueNode(observation.arguments);
  const trace = traceEvents(observation.trace);
  valueNode(record(observation.completion, ["kind", "value"]).value);
  assertDevSafe({ locator: target, generation: observation.generation, sourceGraphDigest: observation.sourceGraphDigest, runtimeProfile });
  const identity = { locator: target, environment: realm, arguments: args, trace };
  const artifact = parseDevCase(devArtifactJson({
    schemaVersion: 2, caseId: createDevCaseId(identity), ...identity, completion: observation.completion,
    comparison: "exact", eligibility: { verdict: "replayable", reasonCodes: ["DEV_TRACE_REPLAYABLE"] },
    provenance: { sourceGraphDigest: normalizeDigest(observation.sourceGraphDigest), lockfileDigest: normalizeDigest(lockfileDigest), runtimeProfile, captureStatus },
  }));
  return parseDevCandidate(devArtifactJson({ ...artifact, occurrences: 1 }));
}

function normalizeDigest(value: string): string { return idPattern.test(value) ? `sha256:${value}` : value; }

export interface DevPersistenceResult { observations: number; candidates: number; duplicates: number; blocked: number; blocks: DevBlock[]; omitted?: number }
export interface DevPersistenceOptions {
  captureStatus?: "complete" | "partial";
  /** Optional per-envelope provenance, aligned with the observations snapshot. */
  observationProfiles?: readonly DevRuntimeProfile[];
  /** Ordered oldest to newest; supplied by the collector after drain. */
  completedGenerations?: readonly string[];
  /** Omission preserves the legacy direct persistence API. Collectors opt in explicitly. */
  retention?: false | Partial<DevRetentionPolicy>;
  retentionState?: DevRetentionSnapshot;
  /** Every supplied observation was already admitted before durable storage. Never resample it. */
  retentionSealed?: boolean;
}

export async function loadDevArtifactIndex(root: string): Promise<{
  accepted: Map<string, DevCase>; acceptedFiles: string[]; pending: Map<string, DevCandidate>;
}> {
  const pendingDirectory = path.join(root, ".replaylock/observations/pending-v2");
  const acceptedDirectory = path.join(root, ".replaylock/cases");
  const accepted = new Map<string, DevCase>();
  const acceptedFiles = await jsonFiles(acceptedDirectory);
  for (const filename of acceptedFiles) {
    const text = await readFile(path.join(acceptedDirectory, filename), "utf8");
    const document = parseDocument(text);
    if (record(document, ["schemaVersion"], Object.keys(document as object)).schemaVersion === 1) continue;
    const artifact = parseDevCase(text);
    if (filename !== `${artifact.caseId}.json`) fail("CASE_ID_MISMATCH");
    accepted.set(artifact.caseId, artifact);
  }
  const pending = new Map<string, DevCandidate>();
  for (const filename of await jsonFiles(pendingDirectory)) {
    const candidate = parseDevCandidate(await readFile(path.join(pendingDirectory, filename), "utf8"));
    if (filename !== `${candidate.caseId}.json`) fail("CASE_ID_MISMATCH");
    pending.set(candidate.caseId, candidate);
  }
  return { accepted, acceptedFiles, pending };
}

/** Observations are a drained snapshot, not incremental chunks. Accepted bytes are never written here. */
export async function persistDevObservations(root: string, observations: readonly DevObservation[], lockfileDigest: string, profiles: Record<DevEnvironment, DevRuntimeProfile>, options: DevPersistenceOptions = {}): Promise<DevPersistenceResult> {
  if (options.observationProfiles && options.observationProfiles.length !== observations.length) fail("INVALID_CONFIGURATION");
  const pendingDirectory = path.join(root, ".replaylock/observations/pending-v2");
  const result: DevPersistenceResult = { observations: observations.length, candidates: 0, duplicates: 0, blocked: 0, blocks: [] };
  const { accepted, acceptedFiles, pending } = await loadDevArtifactIndex(root);
  const useRetention = options.retention !== undefined || options.retentionState !== undefined;
  const retention = useRetention ? await (await import("./dev-retention.js")).loadDevRetention(root, options.retention ?? options.retentionState?.policy,
    options.retentionState ? { snapshot: options.retentionState } : {}) : undefined;
  if (retention) result.omitted = 0;
  const groups = new Map<string, { generation: string; candidates: DevCandidate[] }>();
  const ranks = options.completedGenerations ? new Map(options.completedGenerations.map((generation, rank) => [generation, rank])) : undefined;
  if (ranks && (ranks.size !== options.completedGenerations!.length || [...ranks.keys()].some((generation) => !nonempty(generation)))) fail("INVALID_CONFIGURATION");
  for (const [index, observation] of observations.entries()) {
    if (ranks && !ranks.has(observation.generation)) continue;
    try {
      const candidate = createDevCandidate(observation, lockfileDigest, options.observationProfiles?.[index] ?? profiles[observation.environment], options.captureStatus);
      if (retention && !options.retentionSealed) {
        const admission = retention.admit(candidate);
        if (admission.status === "omitted") { result.omitted!++; continue; }
        if (admission.status === "limit") { result.blocks.push({ code: admission.reason!, locator: candidate.locator }); continue; }
      }
      const key = candidate.caseId;
      const current = groups.get(key);
      if (current && current.generation !== observation.generation && ranks && ranks.get(current.generation)! > ranks.get(observation.generation)!) continue;
      if (!current || current.generation !== observation.generation) groups.set(key, { generation: observation.generation, candidates: [candidate] });
      else current.candidates.push(candidate);
    } catch (error) {
      result.blocks.push({ code: diagnosticCode(error) });
    }
  }
  const changedInputs = new Set(groups.keys());
  const remove = [...pending.values()].filter((entry) => changedInputs.has(entry.caseId));
  for (const entry of remove) pending.delete(entry.caseId);
  const fresh = new Map<string, DevCandidate[]>();
  for (const group of groups.values()) for (const candidate of group.candidates) {
    const entries = fresh.get(candidate.caseId) ?? [];
    entries.push(candidate);
    fresh.set(candidate.caseId, entries);
  }
  for (const [id, entries] of [...fresh].sort(([a], [b]) => a.localeCompare(b))) {
    const candidate = [...entries].sort((a, b) => devArtifactJson(a).localeCompare(devArtifactJson(b)))[0]!;
    if (new Set(entries.map((entry) => devArtifactJson(entry.completion))).size > 1) {
      result.blocks.push({ code: "OBSERVED_NONDETERMINISM", locator: candidate.locator });
      continue;
    }
    result.duplicates += entries.length - 1;
    const existing = accepted.get(id);
    if (existing && devArtifactJson(existing.completion) === devArtifactJson(candidate.completion)) { result.duplicates++; continue; }
    if (pending.size >= DEV_ARTIFACT_LIMITS.maxPendingUnique) { result.blocks.push({ code: "PENDING_LIMIT", locator: candidate.locator }); continue; }
    const additions = [...pending.keys()].filter((key) => !accepted.has(key)).length;
    if (!existing && acceptedFiles.length + additions >= DEV_ARTIFACT_LIMITS.maxProjectUnique) { result.blocks.push({ code: "PROJECT_LIMIT", locator: candidate.locator }); continue; }
    const previous = remove.find((entry) => entry.caseId === id);
    const occurrences = previous && previous.provenance.sourceGraphDigest === candidate.provenance.sourceGraphDigest && devArtifactJson(previous.completion) === devArtifactJson(candidate.completion)
      ? Math.max(entries.length, previous.occurrences) : entries.length;
    const formed = { ...candidate, occurrences, ...(existing ? { replacesCaseId: id } : {}) };
    try { pending.set(id, parseDevCandidate(devArtifactJson(formed))); }
    catch (error) { result.blocks.push({ code: diagnosticCode(error), locator: candidate.locator }); continue; }
    result.candidates++;
  }
  for (const entry of remove) if (!pending.has(entry.caseId)) await unlink(path.join(pendingDirectory, `${entry.caseId}.json`));
  for (const candidate of pending.values()) if (changedInputs.has(candidate.caseId)) await atomicWrite(path.join(pendingDirectory, `${candidate.caseId}.json`), devArtifactJson(candidate));
  result.blocked = result.blocks.length;
  return result;
}

function diagnosticCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : "UNSUPPORTED_VALUE";
}
async function jsonFiles(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort(); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []; throw error; }
}

/** Batch review never silently replaces a previously accepted oracle. */
export async function reviewDevCandidates(root: string, decisions?: AsyncIterator<string>): Promise<number> {
  const pendingDirectory = path.join(root, ".replaylock/observations/pending-v2");
  const candidates = await Promise.all((await jsonFiles(pendingDirectory)).map(async (filename) => {
    const candidate = parseDevCandidate(await readFile(path.join(pendingDirectory, filename), "utf8"));
    if (filename !== `${candidate.caseId}.json`) fail("CASE_ID_MISMATCH");
    return candidate;
  }));
  const groupIds = new Map(candidates.map(candidate => [candidate.caseId, createDevGroupId(candidate)]));
  const reviewKey = (candidate: DevCandidate) => `${candidate.locator.module}\0${candidate.locator.namePath.join(".")}\0${candidate.locator.kind}\0${candidate.environment}\0${groupIds.get(candidate.caseId)}\0${candidate.caseId}`;
  candidates.sort((a, b) => reviewKey(a).localeCompare(reviewKey(b)));
  const groupCounts = new Map<string, number>();
  for (const id of groupIds.values()) groupCounts.set(id, (groupCounts.get(id) ?? 0) + 1);
  if (!candidates.length) return 0;
  const terminal = decisions ? undefined : createInterface({ input: stdin, output: stdout });
  const answers = decisions ?? terminal![Symbol.asyncIterator]();
  const next = async (prompt: string) => { stdout.write(prompt); const answer = await answers.next(); return answer.done ? "" : answer.value; };
  const batch = new Set<string>();
  let previousGroup: string | undefined;
  try {
    for (const candidate of candidates) {
      const casePath = path.join(root, ".replaylock/cases", `${candidate.caseId}.json`);
      let existing: DevCase | undefined;
      try { existing = parseDevCase(await readFile(casePath, "utf8")); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
      if (candidate.replacesCaseId && !existing) fail("REPLACEMENT_MISSING");
      const group = groupIds.get(candidate.caseId)!;
      if (group !== previousGroup) {
        console.log(`Group: ${candidate.locator.module}#${candidate.locator.namePath.join(".")} (${candidate.locator.kind}, ${candidate.environment}) | input/effect ${group.slice(0, 12)} | ${groupCounts.get(group)} candidate(s)`);
        previousGroup = group;
      }
      console.log(`Target: ${candidate.locator.module}#${candidate.locator.namePath.join(".")} (${candidate.environment})\n${devArtifactJson(candidate)}`);
      if (existing) console.log(`Replacement diff:\n${devArtifactJson(existing).split("\n").map((line) => `- ${line}`).join("\n")}\n${devArtifactJson(toDevCase(candidate)).split("\n").map((line) => `+ ${line}`).join("\n")}`);
      const decision = batch.has(candidate.locator.module) && !existing ? "accept" : parseReviewDecision(await next("[a]ccept, [r]eject, [s]kip, [af] accept file, [t] numeric tolerance? "));
      if (!decision) { console.error(`No review decision recorded; retained ${candidate.caseId}`); return 2; }
      if (decision === "skip") continue;
      const pendingPath = path.join(pendingDirectory, `${candidate.caseId}.json`);
      if (decision === "reject") { await unlink(pendingPath); console.log(`Rejected ${candidate.caseId}`); continue; }
      let artifact = toDevCase(candidate);
      if (decision === "accept-tolerance") {
        const epsilon = parseToleranceEpsilon(await next("Epsilon (finite positive number): "));
        if (epsilon === undefined) { console.error("Invalid or missing epsilon; retained candidate"); return 2; }
        artifact = { ...artifact, comparison: { kind: "tolerance", epsilon } };
      }
      if (existing && (await next("Replace accepted case? Type replace: ")).trim().toLowerCase() !== "replace") { console.error(`Replacement not confirmed; retained ${candidate.caseId}`); return 2; }
      await atomicWrite(casePath, devArtifactJson(artifact));
      await unlink(pendingPath);
      console.log(`Accepted ${candidate.caseId}${artifact.comparison === "exact" ? "" : ` (tolerance epsilon ${artifact.comparison.epsilon})`}`);
      if (decision === "accept-remaining-in-file") batch.add(candidate.locator.module);
    }
  } finally { terminal?.close(); }
  return 0;
}
