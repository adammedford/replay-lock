import { createHash } from "node:crypto";
import {
  EFFECT_ANALYZER_VERSION,
  INTRINSIC_CATALOG_VERSION,
  type DirectEffectReasonCode,
} from "./effect-analyzer.js";
import type {
  CallGraphAnalysis,
  CallGraphFinding,
  CallGraphReasonCode,
  ProjectModuleSource,
} from "./call-graph.js";
import { selectProjectLockfile } from "./project-lockfile.js";

export const ASSUMPTION_SCHEMA_VERSION = 1 as const;

export type AssumptionDiagnosticCode =
  | "UNKNOWN_EFFECT"
  | "ASSERTION_CONFLICT"
  | "STALE_ASSERTION";

/** The evidence a reviewed assumption is allowed to discharge. */
export type UnknownEffectCode =
  | "UNKNOWN_CALL"
  | "UNKNOWN_MODULE"
  | "AMBIGUOUS_DISPATCH"
  | "DYNAMIC_IMPORT"
  | "PACKAGE_CALL";

export interface AssumptionFingerprintInput {
  /** Sources participating in the call-graph analysis. */
  modules: ReadonlyMap<string, string> | Readonly<Record<string, string>> | readonly ProjectModuleSource[];
  /** Restrict module bytes to the analyzer's reachable local modules. */
  reachableModules?: readonly string[];
  /** Optional byte-preserving module input for callers reading files directly. */
  moduleBytes?: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>;
  /** Root used to select exactly one supported dependency lockfile. */
  projectRoot?: string;
  /** Explicit lockfile is accepted only as a project-root file. */
  lockfilePath?: string;
  /** Tests and file-system abstractions may provide the complete bytes directly. */
  lockfileBytes?: Uint8Array | string;
  lockfileName?: string;
  unknownEvidence?: readonly CallGraphFinding[];
  analysis?: Pick<CallGraphAnalysis, "reachableModules" | "findings" | "analyzerVersion">;
  analyzerVersion?: string;
  intrinsicCatalogVersion?: string;
}

export interface AssumptionProvenance {
  reason: string;
  /** The exact sorted evidence shown during review, retained forever. */
  originalEvidence: readonly CallGraphFinding[];
  fingerprint: string;
  analyzerVersion: string;
  intrinsicCatalogVersion: string;
}

export interface ReviewedAssumption {
  schemaVersion: typeof ASSUMPTION_SCHEMA_VERSION;
  reason: string;
  fingerprint: string;
  evidence: readonly CallGraphFinding[];
  provenance: AssumptionProvenance;
}

export interface AssumptionEvaluation {
  verdict: "likely-safe" | "refuted" | "unknown";
  code?: AssumptionDiagnosticCode;
  message?: string;
  findings: readonly CallGraphFinding[];
  unknownEvidence: readonly CallGraphFinding[];
  assumption?: ReviewedAssumption;
}

export interface AssumptionFreshness {
  fresh: boolean;
  code?: "STALE_ASSERTION";
  expectedFingerprint: string;
  actualFingerprint: string;
}

const UNKNOWN_CODES: ReadonlySet<CallGraphReasonCode> = new Set<CallGraphReasonCode>([
  "UNKNOWN_CALL",
  "UNKNOWN_MODULE",
  "AMBIGUOUS_DISPATCH",
  "DYNAMIC_IMPORT",
  "PACKAGE_CALL",
]);

const REFUTING_CODES: ReadonlySet<DirectEffectReasonCode> = new Set<DirectEffectReasonCode>([
  "ARGUMENT_MUTATION",
  "RECEIVER_DEPENDENCE",
  "AMBIENT_MUTATION",
  "CLOCK_ACCESS",
  "RANDOMNESS",
  "IO",
  "ENVIRONMENT_DEPENDENCE",
  "LOCALE_DEPENDENCE",
  "LOGGING",
  "DYNAMIC_EVALUATION",
  "EFFECTFUL_INITIALIZATION",
]);

/** Stable ordering used both for review output and fingerprint input. */
export function sortEvidence(findings: readonly CallGraphFinding[]): readonly CallGraphFinding[] {
  return [...findings]
    .map((finding) => ({ ...finding }))
    .sort((left, right) =>
      compareText(left.source, right.source) ||
      left.line - right.line ||
      left.column - right.column ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
    );
}

export function unknownEvidence(findings: readonly CallGraphFinding[]): readonly CallGraphFinding[] {
  return sortEvidence(findings.filter((finding) => UNKNOWN_CODES.has(finding.code)));
}

/**
 * Hash the exact reachable source bytes, one unambiguous project-root
 * dependency lockfile, unknown evidence, and both analyzer version inputs.
 * Length-prefixing prevents path/content concatenation ambiguities.
 */
export function createAssumptionFingerprint(input: AssumptionFingerprintInput): string {
  const modules = moduleEntries(input);
  const reachable = new Set(input.analysis?.reachableModules ?? input.reachableModules ?? modules.map(([name]) => name));
  const selectedModules = modules
    .filter(([name]) => reachable.has(name))
    .sort(([left], [right]) => compareText(left, right));
  if (selectedModules.length !== reachable.size) {
    const missing = [...reachable].filter((name) => !modules.some(([moduleName]) => moduleName === name)).sort(compareText);
    throw new Error(`reachable local module bytes are missing (${missing.join(", ")})`);
  }
  const evidence = unknownEvidence(input.analysis?.findings ?? input.unknownEvidence ?? []);
  const analyzerVersion = input.analyzerVersion ?? input.analysis?.analyzerVersion ?? EFFECT_ANALYZER_VERSION;
  const intrinsicCatalogVersion = input.intrinsicCatalogVersion ?? INTRINSIC_CATALOG_VERSION;
  const lockfile = selectProjectLockfile(input);
  const fields: Uint8Array[] = [
    utf8("replaylock-assumption-fingerprint\0"),
    field("analyzer-version", utf8(analyzerVersion)),
    field("intrinsic-catalog-version", utf8(intrinsicCatalogVersion)),
    field("module-count", utf8(String(selectedModules.length))),
  ];
  for (const [name, bytes] of selectedModules) {
    fields.push(field("module-name", utf8(name)), field("module-bytes", bytes));
  }
  fields.push(field("lockfile-name", utf8(lockfile.name)), field("lockfile-bytes", lockfile.bytes));
  fields.push(field("unknown-evidence-count", utf8(String(evidence.length))));
  for (const finding of evidence) {
    fields.push(field("unknown-evidence", utf8(JSON.stringify({
      code: finding.code,
      source: finding.source,
      line: finding.line,
      column: finding.column,
      message: finding.message,
    }))));
  }
  const hash = createHash("sha256");
  for (const bytes of fields) hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

/** Create the review artifact. The caller is the explicit human-review seam. */
export function reviewAssumption(
  reason: string,
  analysis: CallGraphAnalysis,
  fingerprintInput: Omit<AssumptionFingerprintInput, "analysis" | "unknownEvidence">,
): ReviewedAssumption;
export function reviewAssumption(options: {
  reason: string;
  analysis: CallGraphAnalysis;
  fingerprint: AssumptionFingerprintInput;
}): ReviewedAssumption;
export function reviewAssumption(
  first: string | { reason: string; analysis: CallGraphAnalysis; fingerprint: AssumptionFingerprintInput },
  analysisArg?: CallGraphAnalysis,
  inputArg?: Omit<AssumptionFingerprintInput, "analysis" | "unknownEvidence">,
): ReviewedAssumption {
  const options = typeof first === "string"
    ? { reason: first, analysis: analysisArg!, fingerprint: { ...inputArg!, analysis: analysisArg } }
    : first;
  const reason = requireReason(options.reason);
  const evidence = unknownEvidence(options.analysis.findings);
  if (hasRefutingEvidence(options.analysis)) throw assertionConflict(options.analysis.findings);
  if (evidence.length === 0) throw new Error("assumption requires unknown evidence");
  const fingerprint = createAssumptionFingerprint({
    ...options.fingerprint,
    analysis: options.analysis,
    unknownEvidence: evidence,
  });
  const originalEvidence = freezeEvidence(evidence);
  const provenance: AssumptionProvenance = Object.freeze({
    reason,
    originalEvidence,
    fingerprint,
    analyzerVersion: options.analysis.analyzerVersion,
    intrinsicCatalogVersion: options.fingerprint.intrinsicCatalogVersion ?? INTRINSIC_CATALOG_VERSION,
  });
  return Object.freeze({
    schemaVersion: ASSUMPTION_SCHEMA_VERSION,
    reason,
    fingerprint,
    evidence: originalEvidence,
    provenance,
  });
}

/** Apply a reviewed assumption to unknown evidence, never to refuting evidence. */
export function evaluateAssumption(
  analysis: CallGraphAnalysis,
  assumption?: ReviewedAssumption,
): AssumptionEvaluation {
  const findings = Object.freeze(sortEvidence(analysis.findings).map((finding) => Object.freeze({ ...finding })));
  const unknown = Object.freeze(unknownEvidence(findings));
  if (hasRefutingEvidence(analysis)) {
    return Object.freeze({
      verdict: "refuted",
      code: "ASSERTION_CONFLICT",
      message: "reviewed assumption conflicts with known refuting evidence",
      findings,
      unknownEvidence: unknown,
      ...(assumption ? { assumption } : {}),
    });
  }
  if (
    unknown.length > 0 &&
    (!assumption ||
      assumption.reason.trim().length === 0 ||
      !sameEvidence(unknown, assumption.evidence))
  ) {
    return Object.freeze({
      verdict: "unknown",
      code: "UNKNOWN_EFFECT",
      message: "unknown effect requires a matching reviewed assumption",
      findings,
      unknownEvidence: unknown,
    });
  }
  return Object.freeze({
    verdict: analysis.verdict === "unknown" && unknown.length > 0 ? "likely-safe" : analysis.verdict,
    findings,
    unknownEvidence: unknown,
    ...(assumption ? { assumption } : {}),
  });
}

export function checkAssumptionFreshness(
  assumption: ReviewedAssumption,
  input: AssumptionFingerprintInput,
): AssumptionFreshness {
  const actualFingerprint = createAssumptionFingerprint(input);
  const fresh = actualFingerprint === assumption.fingerprint;
  return Object.freeze({
    fresh,
    ...(fresh ? {} : { code: "STALE_ASSERTION" as const }),
    expectedFingerprint: assumption.fingerprint,
    actualFingerprint,
  });
}

/** The freshness check is deliberately before invocation and cannot be bypassed by a callback. */
export function invokeWithAssumption<T>(
  assumption: ReviewedAssumption,
  input: AssumptionFingerprintInput,
  invoke: () => T,
): T {
  const freshness = checkAssumptionFreshness(assumption, input);
  if (!freshness.fresh) throw new Error("STALE_ASSERTION");
  return invoke();
}

/** Refreshing is intentionally a two-key operation: a new recording and explicit review. */
export function refreshAssumption(options: {
  previous: ReviewedAssumption;
  recording: CallGraphAnalysis;
  fingerprint: Omit<AssumptionFingerprintInput, "analysis" | "unknownEvidence">;
  reason?: string;
  reviewed: true;
}): ReviewedAssumption {
  if (options.reviewed !== true) throw new Error("assumption refresh requires explicit review");
  return reviewAssumption(
    options.reason ?? options.previous.reason,
    options.recording,
    options.fingerprint,
  );
}

function hasRefutingEvidence(analysis: Pick<CallGraphAnalysis, "verdict" | "findings">): boolean {
  return analysis.verdict === "refuted" || analysis.findings.some((finding) => REFUTING_CODES.has(finding.code as DirectEffectReasonCode));
}

function assertionConflict(findings: readonly CallGraphFinding[]): Error {
  const error = new Error("ASSERTION_CONFLICT");
  Object.assign(error, { code: "ASSERTION_CONFLICT", findings: sortEvidence(findings) });
  return error;
}

function requireReason(reason: string): string {
  if (typeof reason !== "string" || reason.trim().length === 0) throw new Error("UNKNOWN_EFFECT");
  return reason.trim();
}

function freezeEvidence(findings: readonly CallGraphFinding[]): readonly CallGraphFinding[] {
  return Object.freeze(findings.map((finding) => Object.freeze({ ...finding })));
}

function sameEvidence(
  current: readonly CallGraphFinding[],
  reviewed: readonly CallGraphFinding[],
): boolean {
  const left = sortEvidence(current);
  const right = sortEvidence(reviewed);
  if (left.length !== right.length) return false;
  return left.every((finding, index) => {
    const other = right[index];
    return other !== undefined &&
      finding.code === other.code &&
      finding.source === other.source &&
      finding.line === other.line &&
      finding.column === other.column &&
      finding.message === other.message;
  });
}

function moduleEntries(input: AssumptionFingerprintInput): [string, Uint8Array][] {
  const sourceEntries: [string, string][] = input.modules instanceof Map
    ? [...input.modules.entries()]
    : Array.isArray(input.modules)
      ? input.modules.map(({ source, text }) => [source, text])
      : Object.entries(input.modules);
  const byteEntries = input.moduleBytes instanceof Map
    ? input.moduleBytes
    : input.moduleBytes ? new Map(Object.entries(input.moduleBytes)) : undefined;
  return sourceEntries.map(([name, text]) => [name, byteEntries?.get(name) ?? utf8(text)]);
}

function utf8(value: string): Uint8Array {
  return Buffer.from(value, "utf8");
}

function field(label: string, bytes: Uint8Array): Uint8Array {
  return Buffer.concat([utf8(`${label}:${bytes.byteLength}:`), bytes, utf8("\0")]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
