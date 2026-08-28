import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import type { ValueAdapterRegistry } from "./adapters.js";

import {
  canonicalCompletionJson,
  encodeCanonicalSnapshot,
  encodeCanonicalValue,
  type CanonicalReplayValueNode,
  type CanonicalAdaptedNode,
  type CanonicalCompletion,
  type CanonicalLimits,
  type ObservedCompletion,
  CanonicalLimitError,
  ValueAdapterPayloadUnsupportedError,
  ValueAdapterSerializationError,
  UnsupportedValueError,
} from "./canonical.js";

export const DEFAULT_OBSERVATION_LIMITS = Object.freeze({
  maxDepth: 20,
  maxNodes: 10_000,
  maxCanonicalBytes: 256 * 1024,
  maxPendingUnique: 1_000,
  maxProjectUnique: 1_000,
});

export type ObservationSafetyCode =
  | "MUTATED_INPUT"
  | "SENSITIVE_VALUE"
  | "OVERSIZED_OBSERVATION"
  | "INCOMPLETE_OBSERVATION"
  | "UNSUPPORTED_VALUE"
  | "VALUE_ADAPTER_SERIALIZE_FAILED"
  | "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED"
  | "PENDING_LIMIT"
  | "PROJECT_LIMIT";

export interface ObservationLocator {
  module: string;
  exportName: string;
}

export interface ObservedInvocation {
  locator: ObservationLocator;
  /** Arguments captured immediately before the callable runs. */
  entryArguments?: readonly unknown[];
  /** Arguments captured immediately after the callable completes. */
  exitArguments?: readonly unknown[];
  /** Trusted in-memory result of snapshotEntryArguments; never accepted from artifacts. */
  entryCanonicalArguments?: CanonicalReplayValueNode;
  completion?: ObservedCompletion;
}

export interface ObservationSafetyLimits {
  maxDepth: number;
  maxNodes: number;
  maxCanonicalBytes: number;
  maxPendingUnique: number;
  maxProjectUnique: number;
}

export interface ObservationDiagnostic {
  code: ObservationSafetyCode;
  locator: ObservationLocator;
  /** A path containing only structural labels; sensitive labels are redacted. */
  path: string;
  /** Alias useful to consumers that call this field safePath. */
  safePath: string;
}

export interface SafeObservation {
  locator: ObservationLocator;
  entryArguments: CanonicalReplayValueNode;
  exitArguments: CanonicalReplayValueNode;
  completion: CanonicalCompletion<CanonicalAdaptedNode>;
  canonicalBytes: number;
  fingerprint: string;
}

export interface SafeObservationResult {
  safe: true;
  ok: true;
  observation: SafeObservation;
}

export interface BlockedObservationResult {
  safe: false;
  ok: false;
  code: ObservationSafetyCode;
  diagnostic: ObservationDiagnostic;
}

export type ObservationSafetyResult = SafeObservationResult | BlockedObservationResult;

export type EntrySnapshotResult =
  | { safe: true; ok: true; arguments: CanonicalReplayValueNode; canonicalBytes: number }
  | BlockedObservationResult;

export interface ClassifyObservationOptions extends Partial<ObservationSafetyLimits> {
  pendingUnique?: number;
  projectUnique?: number;
  valueAdapters?: ValueAdapterRegistry;
}

const BLOCKED_SECRET_KEYS = new Set([
  "password", "passwd", "passphrase", "secret", "apikey", "accesstoken",
  "refreshtoken", "authorization", "cookie", "setcookie", "privatekey", "clientsecret",
]);

/**
 * Take the pre-invocation snapshot without creating any content-derived hash,
 * filename, diagnostic text, or durable record. The caller must still invoke
 * the original target with the original values and classify the full exit.
 */
export function snapshotEntryArguments(
  locator: ObservationLocator,
  arguments_: readonly unknown[],
  options: Pick<ClassifyObservationOptions, "maxDepth" | "maxNodes" | "maxCanonicalBytes" | "valueAdapters"> = {},
): EntrySnapshotResult {
  const limits = resolveLimits(options);
  if (!Array.isArray(arguments_)) {
    return blocked("INCOMPLETE_OBSERVATION", locator, "$", "$", false);
  }
  const state: ScanState = { nodes: 0, maxDepth: limits.maxDepth, maxNodes: limits.maxNodes };
  const finding = scanArguments(arguments_, "$entry", state, options.valueAdapters);
  if (finding) return blockedFinding(locator, finding);
  try {
    const encoded = encodeCanonicalValue(arguments_, {
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxBytes: limits.maxCanonicalBytes,
    }, options.valueAdapters);
    const canonicalFinding = scanCanonicalValue(encoded, "$entry", 0);
    if (canonicalFinding) return blockedFinding(locator, canonicalFinding);
    const canonicalBytes = Buffer.byteLength(JSON.stringify(encoded), "utf8");
    if (canonicalBytes > limits.maxCanonicalBytes) {
      return blocked("OVERSIZED_OBSERVATION", locator, "$", "$", false);
    }
    return { safe: true, ok: true, arguments: encoded, canonicalBytes };
  } catch (error) {
    return blocked(
      error instanceof CanonicalLimitError
        ? "OVERSIZED_OBSERVATION"
        : error instanceof ValueAdapterPayloadUnsupportedError
          ? "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED"
        : error instanceof ValueAdapterSerializationError
          ? "VALUE_ADAPTER_SERIALIZE_FAILED"
          : "UNSUPPORTED_VALUE",
      locator,
      "$",
      "$",
      false,
    );
  }
}

/**
 * Classify one invocation. No hash, case id, log line, diagnostic, or durable
 * object is created until the complete input graph has passed the safety scan.
 */
export function classifyObservation(
  invocation: ObservedInvocation,
  options: ClassifyObservationOptions = {},
): ObservationSafetyResult {
  const limits = resolveLimits(options);
  const captured = readInvocation(invocation);
  const locator = captured?.locator;
  const entry = captured?.entry;
  const exit = captured?.exit;
  const completion = captured?.completion;
  const cachedEntry = captured?.cachedEntry;
  if (!locator || (!Array.isArray(entry) && !cachedEntry) || !Array.isArray(exit) || !isCompletion(completion)) {
    return blocked("INCOMPLETE_OBSERVATION", locator ?? safeLocator(), "$", "$", false);
  }

  const state: ScanState = { nodes: 0, maxDepth: limits.maxDepth, maxNodes: limits.maxNodes };
  if (Array.isArray(entry)) {
    const entryFinding = scanArguments(entry, "$entry", state, options.valueAdapters);
    if (entryFinding) return blockedFinding(locator, entryFinding);
  }
  const exitFinding = scanArguments(exit, "$exit", state, options.valueAdapters);
  if (exitFinding) return blockedFinding(locator, exitFinding);
  const completionFinding = scanCompletion(completion, "$completion", state, options.valueAdapters);
  if (completionFinding) return blockedFinding(locator, completionFinding);

  const pending = options.pendingUnique ?? 0;
  const project = options.projectUnique ?? 0;
  if (pending >= limits.maxPendingUnique) {
    return blocked("PENDING_LIMIT", locator, "$", "$", false);
  }
  if (project >= limits.maxProjectUnique) {
    return blocked("PROJECT_LIMIT", locator, "$", "$", false);
  }

  let entryCanonical: CanonicalReplayValueNode;
  let exitCanonical: CanonicalReplayValueNode;
  let canonicalCompletion: CanonicalCompletion<CanonicalAdaptedNode>;
  try {
    const canonicalLimits: Partial<CanonicalLimits> = {
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxBytes: limits.maxCanonicalBytes,
    };
    entryCanonical = cachedEntry ?? encodeCanonicalValue(entry, canonicalLimits, options.valueAdapters);
    const exitSnapshot = encodeCanonicalSnapshot(exit, completion, canonicalLimits, options.valueAdapters);
    exitCanonical = exitSnapshot.arguments;
    canonicalCompletion = exitSnapshot.completion;
    const canonicalFinding = scanCanonicalValue(
      { kind: "record", entries: [
        { key: "arguments", value: exitCanonical },
        { key: "completion", value: completionValue(canonicalCompletion) },
      ] },
      "$",
      0,
    );
    if (canonicalFinding) return blockedFinding(locator, canonicalFinding);
  } catch (error) {
    if (error instanceof CanonicalLimitError) {
      return blocked("OVERSIZED_OBSERVATION", locator, "$", "$", false);
    }
    if (error instanceof ValueAdapterSerializationError) {
      return blocked("VALUE_ADAPTER_SERIALIZE_FAILED", locator, "$", "$", false);
    }
    if (error instanceof ValueAdapterPayloadUnsupportedError) {
      return blocked("VALUE_ADAPTER_PAYLOAD_UNSUPPORTED", locator, "$", "$", false);
    }
    return blocked("UNSUPPORTED_VALUE", locator, "$", "$", false);
  }

  const canonicalDocument = JSON.stringify({
    entryArguments: entryCanonical,
    exitArguments: exitCanonical,
    completion: canonicalCompletion,
  });
  const canonicalBytes = Buffer.byteLength(canonicalDocument, "utf8");
  if (canonicalBytes > limits.maxCanonicalBytes) {
    return blocked("OVERSIZED_OBSERVATION", locator, "$", "$", false);
  }

  if (JSON.stringify(entryCanonical) !== JSON.stringify(exitCanonical)) {
    return blocked("MUTATED_INPUT", locator, "$", "$", false);
  }

  // This is the first point at which a name/hash is allowed to exist.
  const fingerprint = createHash("sha256").update(canonicalDocument, "utf8").digest("hex");
  const observation: SafeObservation = {
    locator,
    entryArguments: entryCanonical,
    exitArguments: exitCanonical,
    completion: canonicalCompletion,
    canonicalBytes,
    fingerprint,
  };
  return { safe: true, ok: true, observation };
}

export interface ObservationSafetyCollectorOptions extends ClassifyObservationOptions {
  pendingFingerprints?: Iterable<string>;
  projectFingerprints?: Iterable<string>;
}

/** Keeps blocked invocations local while retaining unrelated safe observations. */
export class ObservationSafetyCollector {
  private readonly options: ObservationSafetyCollectorOptions;
  private readonly pending = new Set<string>();
  private readonly project = new Set<string>();

  constructor(options: ObservationSafetyCollectorOptions = {}) {
    this.options = { ...options };
    for (const fingerprint of options.pendingFingerprints ?? []) this.pending.add(fingerprint);
    for (const fingerprint of options.projectFingerprints ?? []) this.project.add(fingerprint);
  }

  observe(invocation: ObservedInvocation): ObservationSafetyResult {
    const result = classifyObservation(invocation, {
      ...this.options,
      // Capacity is checked after the safety classification. This preserves
      // uniqueness semantics: an already-known fingerprint remains harmless
      // even when the cap has been reached.
      pendingUnique: 0,
      projectUnique: 0,
    });
    if (result.safe) {
      if (!this.pending.has(result.observation.fingerprint) && this.pending.size >= (this.options.maxPendingUnique ?? DEFAULT_OBSERVATION_LIMITS.maxPendingUnique)) {
        return blocked("PENDING_LIMIT", result.observation.locator, "$", "$", false);
      }
      if (!this.project.has(result.observation.fingerprint) && this.project.size >= (this.options.maxProjectUnique ?? DEFAULT_OBSERVATION_LIMITS.maxProjectUnique)) {
        return blocked("PROJECT_LIMIT", result.observation.locator, "$", "$", false);
      }
      this.pending.add(result.observation.fingerprint);
      this.project.add(result.observation.fingerprint);
    }
    return result;
  }

  get pendingUnique(): number { return this.pending.size; }
  get projectUnique(): number { return this.project.size; }
  get safeFingerprints(): readonly string[] { return [...this.pending]; }
}

export function collectSafeObservations(
  invocations: Iterable<ObservedInvocation>,
  options: ObservationSafetyCollectorOptions = {},
): { safe: SafeObservation[]; blocked: BlockedObservationResult[] } {
  const collector = new ObservationSafetyCollector(options);
  const safe: SafeObservation[] = [];
  const blocked: BlockedObservationResult[] = [];
  for (const invocation of invocations) {
    const result = collector.observe(invocation);
    if (result.safe) safe.push(result.observation);
    else blocked.push(result);
  }
  return { safe, blocked };
}

export function normalizeSecretKey(key: string): string {
  return key.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  return BLOCKED_SECRET_KEYS.has(normalizeSecretKey(key));
}

function resolveLimits(options: ClassifyObservationOptions): ObservationSafetyLimits {
  const limits = {
    maxDepth: options.maxDepth ?? DEFAULT_OBSERVATION_LIMITS.maxDepth,
    maxNodes: options.maxNodes ?? DEFAULT_OBSERVATION_LIMITS.maxNodes,
    maxCanonicalBytes: options.maxCanonicalBytes ?? DEFAULT_OBSERVATION_LIMITS.maxCanonicalBytes,
    maxPendingUnique: options.maxPendingUnique ?? DEFAULT_OBSERVATION_LIMITS.maxPendingUnique,
    maxProjectUnique: options.maxProjectUnique ?? DEFAULT_OBSERVATION_LIMITS.maxProjectUnique,
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Observation limits must be positive safe integers");
  }
  return limits;
}

interface ScanState { nodes: number; maxDepth: number; maxNodes: number; }
interface Finding { code: ObservationSafetyCode; path: string; sensitiveSegment: boolean; }

function scanArguments(value: readonly unknown[], path: string, state: ScanState, adapters?: ValueAdapterRegistry): Finding | undefined {
  return scanValue(value, path, 0, state, new WeakSet<object>(), false, adapters);
}

function scanCompletion(value: ObservedCompletion, path: string, state: ScanState, adapters?: ValueAdapterRegistry): Finding | undefined {
  const finding = scanValue(value.value, `${path}.value`, 1, state, new WeakSet<object>(), true, adapters);
  return finding;
}

function scanValue(
  value: unknown,
  path: string,
  depth: number,
  state: ScanState,
  seen: WeakSet<object>,
  allowError = false,
  adapters?: ValueAdapterRegistry,
): Finding | undefined {
  if (depth > state.maxDepth) return { code: "OVERSIZED_OBSERVATION", path, sensitiveSegment: false };
  state.nodes += 1;
  if (state.nodes > state.maxNodes) return { code: "OVERSIZED_OBSERVATION", path, sensitiveSegment: false };
  if (typeof value === "string") return isSensitiveString(value)
    ? { code: "SENSITIVE_VALUE", path, sensitiveSegment: false }
    : undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
      return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
    }
    return undefined;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value)) {
    return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
  }
  if (seen.has(value)) return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
  seen.add(value);

  if (adapters?.findForValue(value)) return undefined;

  const prototype = Object.getPrototypeOf(value);
  if (allowError && isStandardErrorPrototype(prototype)) {
    const message = Object.getOwnPropertyDescriptor(value, "message");
    if (message && !isStandardErrorMessageDescriptor(message)) {
      return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
    }
    if (message && typeof message.value === "string" && isSensitiveString(message.value)) {
      return { code: "SENSITIVE_VALUE", path, sensitiveSegment: false };
    }
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== Array.prototype) {
    return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.configurable !== false || lengthDescriptor.enumerable !== false || lengthDescriptor.writable !== true || !Number.isSafeInteger(lengthDescriptor.value)) {
      return { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
    }
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const key = String(index);
      if (!Object.hasOwn(descriptors, key) || !isDataDescriptor(descriptors[key])) {
        return { code: "UNSUPPORTED_VALUE", path: `${path}[${index}]`, sensitiveSegment: false };
      }
      const finding = scanValue(descriptors[key].value, `${path}[${index}]`, depth + 1, state, seen, false, adapters);
      if (finding) return finding;
    }
    return keys.length === lengthDescriptor.value + 1 ? undefined : { code: "UNSUPPORTED_VALUE", path, sensitiveSegment: false };
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!isDataDescriptor(descriptor)) return { code: "UNSUPPORTED_VALUE", path: `${path}.${safeSegment(key)}`, sensitiveSegment: false };
    // Do not put the original key into a finding at all. It may contain a
    // punctuation/case variant such as `API Key`, and redaction must not rely
    // on subsequently parsing a path string.
    if (isSensitiveKey(key) || isSensitiveString(key)) {
      return { code: "SENSITIVE_VALUE", path: `${path}.<redacted>`, sensitiveSegment: true };
    }
    const finding = scanValue(descriptor.value, `${path}.${safeSegment(key)}`, depth + 1, state, seen, false, adapters);
    if (finding) return finding;
  }
  return undefined;
}

function completionValue(completion: CanonicalCompletion<CanonicalAdaptedNode>): CanonicalReplayValueNode {
  if ("value" in completion) return completion.value;
  return {
    kind: "record",
    entries: [
      { key: "message", value: { kind: "string", value: completion.error.message } },
      { key: "name", value: { kind: "string", value: completion.error.name } },
    ],
  };
}

function scanCanonicalValue(value: CanonicalReplayValueNode, path: string, depth: number): Finding | undefined {
  if (value.kind === "string") {
    return isSensitiveString(value.value)
      ? { code: "SENSITIVE_VALUE", path, sensitiveSegment: false }
      : undefined;
  }
  if (value.kind === "array") {
    for (let index = 0; index < value.items.length; index += 1) {
      const found = scanCanonicalValue(value.items[index]!, `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (value.kind === "record") {
    for (const entry of value.entries) {
      if (isSensitiveKey(entry.key) || isSensitiveString(entry.key)) {
        return { code: "SENSITIVE_VALUE", path: `${path}.<redacted>`, sensitiveSegment: true };
      }
      const found = scanCanonicalValue(entry.value, `${path}.${safeSegment(entry.key)}`, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (value.kind === "adapted") {
    return scanCanonicalValue(value.payload, `${path}.payload`, depth + 1);
  }
  return undefined;
}

function isCompletion(value: unknown): value is ObservedCompletion {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  const valueDescriptor = Object.getOwnPropertyDescriptor(value, "value");
  return Boolean(descriptor && valueDescriptor && isDataDescriptor(descriptor) && isDataDescriptor(valueDescriptor) &&
    (descriptor.value === "return" || descriptor.value === "throw"));
}

function isSensitiveString(value: string): boolean {
  if (/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i.test(value)) return true;
  if (/(?:^|\b)AKIA[0-9A-Z]{16}(?:\b|$)/.test(value)) return true;
  if (/(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/.test(value)) return true;
  if (/(?:^|\b)sk-/.test(value)) return true;
  if (/(?:sk_live_|rk_live_)/.test(value)) return true;
  if (/(?:xoxb-|xoxp-|xoxa-|xoxr-|xoxs-)/.test(value)) return true;
  if (/^\s*(?:basic|bearer)\s+\S+/i.test(value)) return true;
  return isValidatedJwt(value);
}

function isValidatedJwt(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  const headerPart = parts[0];
  const payloadPart = parts[1];
  if (headerPart === undefined || payloadPart === undefined) return false;
  try {
    const decode = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const header = decode(headerPart);
    const payload = decode(payloadPart);
    return Boolean(header && typeof header === "object" && !Array.isArray(header) && payload && typeof payload === "object" && !Array.isArray(payload));
  } catch { return false; }
}

function isDataDescriptor(descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & { value: unknown } {
  return Boolean(descriptor && "value" in descriptor && descriptor.configurable === true && descriptor.enumerable === true && descriptor.writable === true);
}

function isStandardErrorMessageDescriptor(
  descriptor: PropertyDescriptor,
): descriptor is PropertyDescriptor & { value: string } {
  return (
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    descriptor.configurable === true &&
    descriptor.enumerable === false &&
    descriptor.writable === true
  );
}

function isStandardErrorPrototype(value: object | null): boolean {
  return value === Error.prototype || value === EvalError.prototype || value === RangeError.prototype || value === ReferenceError.prototype || value === SyntaxError.prototype || value === TypeError.prototype || value === URIError.prototype || value === AggregateError.prototype;
}

function blockedFinding(locator: ObservationLocator, finding: Finding): BlockedObservationResult {
  return blocked(finding.code, locator, finding.path, finding.path, finding.sensitiveSegment);
}

function blocked(code: ObservationSafetyCode, locator: ObservationLocator, path: string, safePath: string, sensitiveSegment: boolean): BlockedObservationResult {
  const diagnosticPath = sensitiveSegment ? redactPath(path) : safePath;
  const diagnostic = { code, locator, path: diagnosticPath, safePath: diagnosticPath };
  return { safe: false, ok: false, code, diagnostic };
}

function redactPath(path: string): string {
  return path;
}

function safeSegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
}

function copyLocator(value: unknown): ObservationLocator | undefined {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) return undefined;
  const moduleDescriptor = Object.getOwnPropertyDescriptor(value, "module");
  const exportDescriptor = Object.getOwnPropertyDescriptor(value, "exportName");
  if (!moduleDescriptor || !exportDescriptor || !isDataDescriptor(moduleDescriptor) || !isDataDescriptor(exportDescriptor) || typeof moduleDescriptor.value !== "string" || typeof exportDescriptor.value !== "string") return undefined;
  return { module: moduleDescriptor.value, exportName: exportDescriptor.value };
}

interface CapturedInvocation {
  locator: ObservationLocator;
  entry?: readonly unknown[];
  cachedEntry?: CanonicalReplayValueNode;
  exit: readonly unknown[];
  completion: ObservedCompletion;
}

function readInvocation(value: unknown): CapturedInvocation | undefined {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) return undefined;
  const locatorDescriptor = Object.getOwnPropertyDescriptor(value, "locator");
  const entryDescriptor = Object.getOwnPropertyDescriptor(value, "entryArguments");
  const cachedEntryDescriptor = Object.getOwnPropertyDescriptor(value, "entryCanonicalArguments");
  const exitDescriptor = Object.getOwnPropertyDescriptor(value, "exitArguments");
  const completionDescriptor = Object.getOwnPropertyDescriptor(value, "completion");
  if (
    !locatorDescriptor || !exitDescriptor || !completionDescriptor ||
    !isDataDescriptor(locatorDescriptor) || !isDataDescriptor(exitDescriptor) ||
    !isDataDescriptor(completionDescriptor) ||
    (entryDescriptor !== undefined && !isDataDescriptor(entryDescriptor)) ||
    (cachedEntryDescriptor !== undefined && !isDataDescriptor(cachedEntryDescriptor))
  ) return undefined;
  const locator = copyLocator(locatorDescriptor.value);
  const entry = entryDescriptor?.value;
  const cachedEntry = cachedEntryDescriptor?.value;
  if (
    !locator || (!Array.isArray(entry) && cachedEntry === undefined) ||
    !Array.isArray(exitDescriptor.value) || !isCompletion(completionDescriptor.value)
  ) return undefined;
  return {
    locator,
    ...(Array.isArray(entry) ? { entry } : {}),
    ...(cachedEntry !== undefined ? { cachedEntry: cachedEntry as CanonicalReplayValueNode } : {}),
    exit: exitDescriptor.value,
    completion: completionDescriptor.value,
  };
}

function safeLocator(): ObservationLocator {
  return { module: "<unknown>", exportName: "<unknown>" };
}

export function formatObservationDiagnostic(diagnostic: ObservationDiagnostic): string {
  return `${diagnostic.code} ${diagnostic.locator.module}#${diagnostic.locator.exportName} ${diagnostic.safePath}`;
}
