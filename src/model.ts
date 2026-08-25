import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CASE_SCHEMA_VERSION = 1 as const;
export const REPLAYLOCK_VERSION = "0.1.0" as const;

export interface CallableLocator {
  module: string;
  exportName: string;
}

export interface CaptureMetadata {
  locator: CallableLocator;
  sourceGraphDigest: string;
}

export interface RuntimeProfile {
  node: string;
  vite: string;
  vitest: string;
  replaylock: string;
  platform: NodeJS.Platform;
  architecture: string;
  timezone: string;
  locale: string;
}

export interface ObservedReturnCompletion {
  kind: "return";
  value: number;
}

export interface Observation extends CaptureMetadata {
  token: string;
  arguments: number[];
  completion: ObservedReturnCompletion;
  runtimeProfile: RuntimeProfile;
}

export interface CanonicalNumberNode {
  kind: "number";
  value: number;
}

export interface CanonicalArrayNode {
  kind: "array";
  items: CanonicalNumberNode[];
}

export interface CanonicalReturnCompletion {
  kind: "return";
  value: CanonicalNumberNode;
}

export interface EligibilityEvidence {
  basis: "automatic";
  verdict: "likely-safe";
  reasonCodes: string[];
}

export interface CaseProvenance {
  sourceGraphDigest: string;
  lockfileDigest: string;
  runtimeProfile: RuntimeProfile;
}

export interface CaseArtifact {
  schemaVersion: typeof CASE_SCHEMA_VERSION;
  caseId: string;
  locator: CallableLocator;
  arguments: CanonicalArrayNode;
  completion: CanonicalReturnCompletion;
  comparison: "exact";
  eligibility: EligibilityEvidence;
  provenance: CaseProvenance;
}

export interface CandidateArtifact extends CaseArtifact {
  occurrences: number;
}

export function isReplayNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

export function validateObservation(value: unknown): Observation {
  if (!isObject(value)) {
    throw new Error("Observation must be an object");
  }

  const locator = value.locator;
  const completion = value.completion;
  if (
    typeof value.token !== "string" ||
    !isObject(locator) ||
    typeof locator.module !== "string" ||
    typeof locator.exportName !== "string" ||
    locator.exportName.length === 0 ||
    !Array.isArray(value.arguments) ||
    !value.arguments.every(isReplayNumber) ||
    !isObject(completion) ||
    completion.kind !== "return" ||
    !isReplayNumber(completion.value) ||
    !isSha256Digest(value.sourceGraphDigest) ||
    !isRuntimeProfile(value.runtimeProfile)
  ) {
    throw new Error("Observation is outside the issue 2 finite-number contract");
  }

  return {
    token: value.token,
    locator: {
      module: normalizeModuleLocator(locator.module),
      exportName: locator.exportName,
    },
    arguments: [...value.arguments],
    completion: { kind: "return", value: completion.value },
    sourceGraphDigest: value.sourceGraphDigest,
    runtimeProfile: { ...value.runtimeProfile },
  };
}

export function createCandidate(
  observation: Observation,
  lockfileDigest: string,
): CandidateArtifact {
  if (!isSha256Digest(lockfileDigest)) {
    throw new Error("Lockfile digest must be a SHA-256 digest");
  }

  const canonicalArguments = encodeArguments(observation.arguments);
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    caseId: createCaseId(observation.locator, canonicalArguments),
    locator: { ...observation.locator },
    arguments: canonicalArguments,
    completion: {
      kind: "return",
      value: encodeNumber(observation.completion.value),
    },
    comparison: "exact",
    eligibility: {
      basis: "automatic",
      verdict: "likely-safe",
      reasonCodes: ["ISSUE_2_DIRECT_EXPORTED_SYNC_NUMERIC_LEAF"],
    },
    provenance: {
      sourceGraphDigest: observation.sourceGraphDigest,
      lockfileDigest,
      runtimeProfile: { ...observation.runtimeProfile },
    },
    occurrences: 1,
  };
}

export function toCaseArtifact(candidate: CandidateArtifact): CaseArtifact {
  const { occurrences: _occurrences, ...artifact } = candidate;
  return artifact;
}

export function parseCandidate(text: string): CandidateArtifact {
  const value: unknown = JSON.parse(text);
  const artifact = parseCaseShape(value);
  if (!isObject(value) || !Number.isInteger(value.occurrences) || Number(value.occurrences) < 1) {
    throw new Error("Candidate occurrences must be a positive integer");
  }
  return { ...artifact, occurrences: Number(value.occurrences) };
}

export function parseCase(text: string): CaseArtifact {
  return parseCaseShape(JSON.parse(text) as unknown);
}

export function decodeArguments(value: CanonicalArrayNode): number[] {
  return value.items.map((item) => item.value);
}

export function artifactJson(value: CandidateArtifact | CaseArtifact): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export function normalizeModuleLocator(modulePath: string): string {
  const normalized = modulePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => segment === "" || segment === ".." || segment === ".")
  ) {
    throw new Error("Callable module locator must be normalized inside the project root");
  }
  return normalized;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCaseShape(value: unknown): CaseArtifact {
  if (!isObject(value) || value.schemaVersion !== CASE_SCHEMA_VERSION) {
    throw new Error("Unsupported case schema");
  }

  const locator = parseLocator(value.locator);
  const canonicalArguments = parseCanonicalArguments(value.arguments);
  const completion = value.completion;
  const eligibility = value.eligibility;
  const provenance = value.provenance;
  if (
    typeof value.caseId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.caseId) ||
    !isObject(completion) ||
    completion.kind !== "return" ||
    !isCanonicalNumberNode(completion.value) ||
    value.comparison !== "exact" ||
    !isEligibilityEvidence(eligibility) ||
    !isCaseProvenance(provenance)
  ) {
    throw new Error("Malformed finite-number case artifact");
  }

  const expectedCaseId = createCaseId(locator, canonicalArguments);
  if (value.caseId !== expectedCaseId) {
    throw new Error("Case ID does not match the canonical callable arguments");
  }

  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    caseId: value.caseId,
    locator,
    arguments: canonicalArguments,
    completion: {
      kind: "return",
      value: { kind: "number", value: completion.value.value },
    },
    comparison: "exact",
    eligibility: {
      basis: eligibility.basis,
      verdict: eligibility.verdict,
      reasonCodes: [...eligibility.reasonCodes],
    },
    provenance: {
      sourceGraphDigest: provenance.sourceGraphDigest,
      lockfileDigest: provenance.lockfileDigest,
      runtimeProfile: { ...provenance.runtimeProfile },
    },
  };
}

function parseLocator(value: unknown): CallableLocator {
  if (
    !isObject(value) ||
    typeof value.module !== "string" ||
    typeof value.exportName !== "string" ||
    value.exportName.length === 0
  ) {
    throw new Error("Malformed callable locator");
  }
  const normalized = normalizeModuleLocator(value.module);
  if (normalized !== value.module) {
    throw new Error("Callable module locator must use project-relative POSIX form");
  }
  return { module: normalized, exportName: value.exportName };
}

function encodeArguments(values: number[]): CanonicalArrayNode {
  return { kind: "array", items: values.map(encodeNumber) };
}

function encodeNumber(value: number): CanonicalNumberNode {
  if (!isReplayNumber(value)) throw new Error("Unsupported numeric value");
  return { kind: "number", value };
}

function parseCanonicalArguments(value: unknown): CanonicalArrayNode {
  if (!isObject(value) || value.kind !== "array" || !Array.isArray(value.items)) {
    throw new Error("Malformed canonical argument list");
  }
  if (!value.items.every(isCanonicalNumberNode)) {
    throw new Error("Malformed canonical numeric argument");
  }
  return {
    kind: "array",
    items: value.items.map((item) => ({ kind: "number", value: item.value })),
  };
}

function createCaseId(locator: CallableLocator, arguments_: CanonicalArrayNode): string {
  const fields = [
    String(CASE_SCHEMA_VERSION),
    locator.module,
    locator.exportName,
    JSON.stringify(arguments_),
  ];
  const identityBytes = fields
    .map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`)
    .join("");
  return createHash("sha256").update(identityBytes, "utf8").digest("hex");
}

function isCanonicalNumberNode(value: unknown): value is CanonicalNumberNode {
  return isObject(value) && value.kind === "number" && isReplayNumber(value.value);
}

function isEligibilityEvidence(value: unknown): value is EligibilityEvidence {
  return (
    isObject(value) &&
    value.basis === "automatic" &&
    value.verdict === "likely-safe" &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.length > 0 &&
    value.reasonCodes.every((code) => typeof code === "string" && code.length > 0)
  );
}

function isCaseProvenance(value: unknown): value is CaseProvenance {
  return (
    isObject(value) &&
    isSha256Digest(value.sourceGraphDigest) &&
    isSha256Digest(value.lockfileDigest) &&
    isRuntimeProfile(value.runtimeProfile)
  );
}

function isRuntimeProfile(value: unknown): value is RuntimeProfile {
  return (
    isObject(value) &&
    typeof value.node === "string" &&
    typeof value.vite === "string" &&
    typeof value.vitest === "string" &&
    typeof value.replaylock === "string" &&
    typeof value.platform === "string" &&
    typeof value.architecture === "string" &&
    typeof value.timezone === "string" &&
    typeof value.locale === "string" &&
    [
      value.node,
      value.vite,
      value.vitest,
      value.replaylock,
      value.platform,
      value.architecture,
      value.timezone,
      value.locale,
    ].every((part) => part.length > 0)
  );
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
