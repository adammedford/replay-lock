import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeCanonicalCompletion,
  decodeCanonicalValue,
  encodeCanonicalCompletion,
  encodeCanonicalValue,
  type BuiltInValue,
  type CanonicalArrayNode as CanonicalArrayValueNode,
  type CanonicalAdaptedNode,
  type CanonicalBuiltInValueNode,
  type CanonicalReplayValueNode,
  type CanonicalCompletion as CanonicalCompletionValue,
} from "./canonical.js";

export const CASE_SCHEMA_VERSION = 1 as const;
export const REPLAYLOCK_VERSION = "0.1.0" as const;

export interface CallableLocator {
  module: string;
  exportName: string;
}

export interface TrustedPackageCaptureEvidence {
  package: string;
  export: string;
  matchedVersion?: string;
  unpinned: boolean;
}

export interface CaptureMetadata {
  locator: CallableLocator;
  sourceGraphDigest: string;
  assumption?: AssumptionCaptureEvidence;
  packageTrust?: TrustedPackageCaptureEvidence[];
}

export interface AssumptionEvidenceFinding {
  code: string;
  source: string;
  line: number;
  column: number;
  message: string;
}

export interface AssumptionCaptureEvidence {
  reason: string;
  fingerprint: string;
  originalEvidence: AssumptionEvidenceFinding[];
  analyzerVersion: string;
  intrinsicCatalogVersion: string;
}

export type SourceDiagnosticCode =
  | "INVALID_POLICY"
  | "UNSUPPORTED_CALLABLE"
  | "KNOWN_EFFECT"
  | "ASSERTION_CONFLICT"
  | "EFFECT_REFUTED"
  | "UNKNOWN_EFFECT"
  | "STALE_ASSERTION";

export interface SourceDiagnostic {
  code: SourceDiagnosticCode;
  source: string;
  line: number;
  column: number;
  message: string;
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

export interface Observation extends CaptureMetadata {
  token: string;
  arguments: CanonicalArrayValueNode<CanonicalAdaptedNode>;
  completion: CanonicalCompletionValue<CanonicalAdaptedNode>;
  runtimeProfile: RuntimeProfile;
}

export type CanonicalArrayNode = CanonicalArrayValueNode<CanonicalAdaptedNode>;
export type CanonicalCompletion = CanonicalCompletionValue<CanonicalAdaptedNode>;

export interface EligibilityEvidence {
  basis: "automatic" | "assumption" | "catalog";
  verdict: "likely-safe";
  reasonCodes: string[];
  assumption?: AssumptionCaptureEvidence;
  packageTrust?: TrustedPackageCaptureEvidence[];
}

export interface CaseProvenance {
  sourceGraphDigest: string;
  lockfileDigest: string;
  runtimeProfile: RuntimeProfile;
  /** Whether the candidate came from a clean or partially recovered recording session. */
  captureStatus: "complete" | "partial";
}

/**
 * An opt-in review-time decision, never a recording-time one: `createCandidate`
 * always produces `"exact"`. A reviewer may explicitly accept a candidate with
 * a numeric tolerance instead (see `acceptReviewedCandidate` in review.ts).
 * Additive to the existing literal `"exact"` shape (a string vs. an object is
 * structurally distinguishable), so this does not require a CASE_SCHEMA_VERSION
 * bump: every existing accepted case remains a valid `"exact"`-comparison case.
 */
export interface ToleranceComparison {
  kind: "tolerance";
  epsilon: number;
}

export type CaseComparison = "exact" | ToleranceComparison;

export interface CaseArtifact {
  schemaVersion: typeof CASE_SCHEMA_VERSION;
  caseId: string;
  locator: CallableLocator;
  arguments: CanonicalArrayNode;
  completion: CanonicalCompletion;
  comparison: CaseComparison;
  eligibility: EligibilityEvidence;
  provenance: CaseProvenance;
}

export interface CandidateArtifact extends CaseArtifact {
  occurrences: number;
  /** Present when this session observed behavior different from a reviewed case. */
  replacesCaseId?: string;
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
    !isObject(completion) ||
    !isSha256Digest(value.sourceGraphDigest) ||
    !isRuntimeProfile(value.runtimeProfile)
  ) {
    throw new Error("Malformed ReplayLock observation");
  }

  const representation = Array.isArray(value.arguments) ? "raw" : "canonical";
  const canonicalArguments = normalizeObservedArguments(value.arguments);
  const canonicalCompletion = normalizeObservedCompletion(completion, representation);
  const assumption = value.assumption === undefined
    ? undefined
    : parseAssumptionCaptureEvidence(value.assumption);
  const packageTrust = value.packageTrust === undefined
    ? undefined
    : parseTrustedPackageCaptureEvidenceList(value.packageTrust);

  return {
    token: value.token,
    locator: {
      module: normalizeModuleLocator(locator.module),
      exportName: locator.exportName,
    },
    arguments: canonicalArguments,
    completion: canonicalCompletion,
    sourceGraphDigest: value.sourceGraphDigest,
    runtimeProfile: { ...value.runtimeProfile },
    ...(assumption ? { assumption } : {}),
    ...(packageTrust ? { packageTrust } : {}),
  };
}

export function validateSourceDiagnostic(value: unknown): SourceDiagnostic {
  if (
    !isObject(value) ||
    ![
      "INVALID_POLICY",
      "UNSUPPORTED_CALLABLE",
      "KNOWN_EFFECT",
      "ASSERTION_CONFLICT",
      "EFFECT_REFUTED",
      "UNKNOWN_EFFECT",
      "STALE_ASSERTION",
    ].includes(value.code as string) ||
    typeof value.source !== "string" ||
    value.source.length === 0 ||
    typeof value.line !== "number" ||
    !Number.isInteger(value.line) ||
    value.line < 1 ||
    typeof value.column !== "number" ||
    !Number.isInteger(value.column) ||
    value.column < 1 ||
    typeof value.message !== "string" ||
    value.message.length === 0
  ) {
    throw new Error("Malformed ReplayLock source diagnostic");
  }

  return {
    code: value.code as SourceDiagnosticCode,
    source: value.source,
    line: value.line,
    column: value.column,
    message: value.message,
  };
}

export function createCandidate(
  observation: Observation,
  lockfileDigest: string,
  captureStatus: CaseProvenance["captureStatus"] = "complete",
): CandidateArtifact {
  if (!isSha256Digest(lockfileDigest)) {
    throw new Error("Lockfile digest must be a SHA-256 digest");
  }

  const representation = Array.isArray(observation.arguments) ? "raw" : "canonical";
  const canonicalArguments = normalizeObservedArguments(observation.arguments);
  const canonicalCompletion = normalizeObservedCompletion(observation.completion, representation);
  const legacyNumericLeaf =
    canonicalArguments.items.every((item) => item.kind === "number") &&
    canonicalCompletion.kind === "return" &&
    "value" in canonicalCompletion &&
    canonicalCompletion.value.kind === "number";
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    caseId: createCaseId(observation.locator, canonicalArguments),
    locator: { ...observation.locator },
    arguments: canonicalArguments,
    completion: canonicalCompletion,
    comparison: "exact",
    eligibility: {
      basis: observation.assumption ? "assumption" : (observation.packageTrust?.length ?? 0) > 0 ? "catalog" : "automatic",
      verdict: "likely-safe",
      reasonCodes: [observation.assumption
        ? "ASSUMED_UNKNOWN_EFFECT"
        : (observation.packageTrust?.length ?? 0) > 0
          ? "TRUSTED_PACKAGE_CALL"
          : legacyNumericLeaf
            ? "ISSUE_2_DIRECT_EXPORTED_SYNC_NUMERIC_LEAF"
            : "STATIC_ANALYSIS_LIKELY_SAFE"],
      ...(observation.assumption ? { assumption: cloneAssumptionCaptureEvidence(observation.assumption) } : {}),
      ...(observation.packageTrust && observation.packageTrust.length > 0
        ? { packageTrust: observation.packageTrust.map(cloneTrustedPackageCaptureEvidence) }
        : {}),
    },
    provenance: {
      sourceGraphDigest: observation.sourceGraphDigest,
      lockfileDigest,
      runtimeProfile: { ...observation.runtimeProfile },
      captureStatus,
    },
    occurrences: 1,
  };
}

export function toCaseArtifact(candidate: CandidateArtifact): CaseArtifact {
  const { occurrences: _occurrences, replacesCaseId: _replacesCaseId, ...artifact } = candidate;
  return artifact;
}

export function parseCandidate(text: string): CandidateArtifact {
  const value: unknown = JSON.parse(text);
  const artifact = parseCaseShape(value);
  if (!isObject(value) || !Number.isInteger(value.occurrences) || Number(value.occurrences) < 1) {
    throw new Error("Candidate occurrences must be a positive integer");
  }
  const replacesCaseId = value.replacesCaseId;
  if (
    replacesCaseId !== undefined &&
    (typeof replacesCaseId !== "string" || !/^[a-f0-9]{64}$/.test(replacesCaseId))
  ) {
    throw new Error("Replacement case ID must be a SHA-256 digest");
  }
  return {
    ...artifact,
    occurrences: Number(value.occurrences),
    ...(typeof replacesCaseId === "string" ? { replacesCaseId } : {}),
  };
}

export function parseCase(text: string): CaseArtifact {
  return parseCaseShape(JSON.parse(text) as unknown);
}

export function decodeArguments(value: CanonicalArrayNode): BuiltInValue[] {
  const decoded = decodeCanonicalValue(value);
  if (!Array.isArray(decoded)) throw new Error("Malformed canonical argument list");
  return decoded;
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
  const comparison = parseCaseComparison(value.comparison);
  if (
    typeof value.caseId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.caseId) ||
    !isObject(completion) ||
    comparison === undefined ||
    !isEligibilityEvidence(eligibility) ||
    !isCaseProvenance(provenance)
  ) {
    throw new Error("Malformed case artifact");
  }
  const canonicalCompletion = normalizeCanonicalCompletion(completion);

  const expectedCaseId = createCaseId(locator, canonicalArguments);
  if (value.caseId !== expectedCaseId) {
    throw new Error("Case ID does not match the canonical callable arguments");
  }

  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    caseId: value.caseId,
    locator,
    arguments: canonicalArguments,
    completion: canonicalCompletion,
    comparison,
    eligibility: {
      basis: eligibility.basis,
      verdict: eligibility.verdict,
      reasonCodes: [...eligibility.reasonCodes],
      ...(eligibility.assumption
        ? { assumption: cloneAssumptionCaptureEvidence(eligibility.assumption) }
        : {}),
      ...(eligibility.packageTrust && eligibility.packageTrust.length > 0
        ? { packageTrust: eligibility.packageTrust.map(cloneTrustedPackageCaptureEvidence) }
        : {}),
    },
    provenance: {
      sourceGraphDigest: provenance.sourceGraphDigest,
      lockfileDigest: provenance.lockfileDigest,
      runtimeProfile: { ...provenance.runtimeProfile },
      captureStatus: provenance.captureStatus ?? "complete",
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

function parseCanonicalArguments(value: unknown): CanonicalArrayNode {
  const normalized = normalizeCanonicalValue(value);
  if (normalized.kind !== "array") throw new Error("Malformed canonical argument list");
  return normalized;
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

function normalizeObservedArguments(value: unknown): CanonicalArrayNode {
  if (Array.isArray(value)) {
    const encoded = encodeCanonicalValue(value);
    if (encoded.kind !== "array") throw new Error("Malformed observation arguments");
    return encoded;
  }
  return parseCanonicalArguments(value);
}

function normalizeObservedCompletion(
  value: unknown,
  representation: "raw" | "canonical",
): CanonicalCompletion {
  if (!isObject(value)) throw new Error("Malformed observation completion");
  if (representation === "raw") {
    if ((value.kind !== "return" && value.kind !== "throw") || !Object.hasOwn(value, "value")) {
      throw new Error("Malformed raw observation completion");
    }
    return encodeCanonicalCompletion({ kind: value.kind, value: value.value });
  }
  return normalizeCanonicalCompletion(value);
}

function normalizeCanonicalValue(value: unknown): CanonicalReplayValueNode {
  return normalizeReplayNode(value);
}

function normalizeCanonicalCompletion(value: unknown): CanonicalCompletion {
  if (!isObject(value) || (value.kind !== "return" && value.kind !== "throw")) {
    throw new Error("Malformed canonical completion");
  }
  if (value.kind === "throw" && Object.hasOwn(value, "error")) {
    return encodeCanonicalCompletion(decodeCanonicalCompletion(value)) as CanonicalCompletion;
  }
  if (!Object.hasOwn(value, "value")) throw new Error("Malformed canonical completion");
  const normalized = normalizeReplayNode(value.value);
  return value.kind === "return"
    ? { kind: "return", value: normalized }
    : { kind: "throw", value: normalized };
}

function normalizeReplayNode(value: unknown): CanonicalReplayValueNode {
  if (isObject(value) && value.kind === "adapted") {
    if (
      Object.keys(value).sort().join(",") !== "adapterId,kind,payload,version" ||
      typeof value.adapterId !== "string" || value.adapterId.length === 0 ||
      !Number.isSafeInteger(value.version) || Number(value.version) < 1
    ) throw new Error("Malformed adapted canonical node");
    return {
      kind: "adapted",
      adapterId: value.adapterId,
      version: Number(value.version),
      payload: encodeCanonicalValue(decodeCanonicalValue(value.payload)) as CanonicalBuiltInValueNode,
    };
  }
  if (isObject(value) && value.kind === "array" && Array.isArray(value.items)) {
    return { kind: "array", items: value.items.map(normalizeReplayNode) };
  }
  if (isObject(value) && value.kind === "record" && Array.isArray(value.entries)) {
    const entries = value.entries.map((entry) => {
      if (!isObject(entry) || typeof entry.key !== "string") throw new Error("Malformed canonical record entry");
      return { key: entry.key, value: normalizeReplayNode(entry.value) };
    });
    const keys = entries.map(({ key }) => key);
    if (keys.some((key, index) => index > 0 && key <= (keys[index - 1] ?? ""))) throw new Error("Malformed canonical record order");
    return { kind: "record", entries };
  }
  return encodeCanonicalValue(decodeCanonicalValue(value)) as CanonicalReplayValueNode;
}

function parseCaseComparison(value: unknown): CaseComparison | undefined {
  if (value === "exact") return "exact";
  if (
    isObject(value) &&
    value.kind === "tolerance" &&
    typeof value.epsilon === "number" &&
    Number.isFinite(value.epsilon) &&
    value.epsilon > 0 &&
    Object.keys(value).sort().join(",") === "epsilon,kind"
  ) {
    return { kind: "tolerance", epsilon: value.epsilon };
  }
  return undefined;
}

function isEligibilityEvidence(value: unknown): value is EligibilityEvidence {
  if (
    !(
    isObject(value) &&
    (value.basis === "automatic" || value.basis === "assumption" || value.basis === "catalog") &&
    value.verdict === "likely-safe" &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.length > 0 &&
    value.reasonCodes.every((code) => typeof code === "string" && code.length > 0)
    )
  ) return false;
  if (!isValidPackageTrustField(value.packageTrust)) return false;
  const hasPackageTrust = Array.isArray(value.packageTrust) && value.packageTrust.length > 0;
  if (value.basis === "automatic") return value.assumption === undefined && !hasPackageTrust;
  if (value.basis === "catalog") return value.assumption === undefined && hasPackageTrust;
  try {
    parseAssumptionCaptureEvidence(value.assumption);
    return true;
  } catch {
    return false;
  }
}

function isValidPackageTrustField(value: unknown): boolean {
  if (value === undefined) return true;
  try {
    parseTrustedPackageCaptureEvidenceList(value);
    return true;
  } catch {
    return false;
  }
}

function parseAssumptionCaptureEvidence(value: unknown): AssumptionCaptureEvidence {
  if (
    !isObject(value) ||
    typeof value.reason !== "string" ||
    value.reason.trim().length === 0 ||
    !isSha256Digest(value.fingerprint) ||
    typeof value.analyzerVersion !== "string" ||
    value.analyzerVersion.length === 0 ||
    typeof value.intrinsicCatalogVersion !== "string" ||
    value.intrinsicCatalogVersion.length === 0 ||
    !Array.isArray(value.originalEvidence)
  ) throw new Error("Malformed assumption capture evidence");
  const originalEvidence = value.originalEvidence.map((finding) => {
    if (
      !isObject(finding) ||
      typeof finding.code !== "string" ||
      typeof finding.source !== "string" ||
      !Number.isSafeInteger(finding.line) ||
      Number(finding.line) < 1 ||
      !Number.isSafeInteger(finding.column) ||
      Number(finding.column) < 1 ||
      typeof finding.message !== "string"
    ) throw new Error("Malformed assumption unknown evidence");
    return {
      code: finding.code,
      source: finding.source,
      line: Number(finding.line),
      column: Number(finding.column),
      message: finding.message,
    };
  });
  if (originalEvidence.length === 0) throw new Error("Assumption evidence cannot be empty");
  return {
    reason: value.reason.trim(),
    fingerprint: value.fingerprint,
    originalEvidence,
    analyzerVersion: value.analyzerVersion,
    intrinsicCatalogVersion: value.intrinsicCatalogVersion,
  };
}

function cloneAssumptionCaptureEvidence(value: AssumptionCaptureEvidence): AssumptionCaptureEvidence {
  return {
    ...value,
    originalEvidence: value.originalEvidence.map((finding) => ({ ...finding })),
  };
}

function parseTrustedPackageCaptureEvidenceList(value: unknown): TrustedPackageCaptureEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Malformed trusted package capture evidence");
  }
  return value.map(parseTrustedPackageCaptureEvidence);
}

function parseTrustedPackageCaptureEvidence(value: unknown): TrustedPackageCaptureEvidence {
  if (
    !isObject(value) ||
    typeof value.package !== "string" ||
    value.package.length === 0 ||
    typeof value.export !== "string" ||
    value.export.length === 0 ||
    typeof value.unpinned !== "boolean" ||
    (value.matchedVersion !== undefined &&
      (typeof value.matchedVersion !== "string" || value.matchedVersion.length === 0))
  ) {
    throw new Error("Malformed trusted package capture evidence");
  }
  return {
    package: value.package,
    export: value.export,
    unpinned: value.unpinned,
    ...(typeof value.matchedVersion === "string" ? { matchedVersion: value.matchedVersion } : {}),
  };
}

function cloneTrustedPackageCaptureEvidence(value: TrustedPackageCaptureEvidence): TrustedPackageCaptureEvidence {
  return { ...value };
}

function isCaseProvenance(value: unknown): value is CaseProvenance {
  return (
    isObject(value) &&
    isSha256Digest(value.sourceGraphDigest) &&
    isSha256Digest(value.lockfileDigest) &&
    isRuntimeProfile(value.runtimeProfile) &&
    (value.captureStatus === undefined ||
      value.captureStatus === "complete" ||
      value.captureStatus === "partial")
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
