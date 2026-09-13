import type { DevCase, DevCodecOptions, DevCompletion, DevValue } from "./dev-contract.js";
import type { DevTraceDifference } from "./dev-runtime.js";
import { assertDevSafe, encodeDevValue, validateDevValue } from "./dev-values.js";

export interface DevDifference { path: string; expected: string; actual: string }
type Comparison = DevCase["comparison"];
type Identity = Pick<DevCase, "locator" | "environment" | "caseId">;
const EXCERPT_LIMIT = 120;
const bounded = (text: string, limit: number): string => text.length <= limit ? text : text.slice(0, limit - 1) + "…";
const printable = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
const quoted = (value: unknown): string => bounded(printable(JSON.stringify(value)), EXCERPT_LIMIT);
const property = (path: string, key: string): string => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

function excerpt(value: DevValue | undefined): string {
  if (!value) return "<missing>";
  switch (value.kind) {
    case "undefined": case "null": return value.kind;
    case "boolean": case "number": case "string": return quoted(value.value);
    case "date": return `Date(${quoted(value.value)})`;
    case "bytes": return `${value.type}(${quoted(value.value)})`;
    case "array": return `Array(${value.items.length})`;
    case "record": return bounded(`Object(${value.entries.map(entry => quoted(entry.key)).join(", ")})`, EXCERPT_LIMIT);
    case "error": return bounded(`${value.name}(${quoted(value.message)})`, EXCERPT_LIMIT);
    case "adapted": return bounded(`Adapter(${quoted(value.adapterId)}, version ${value.version})`, EXCERPT_LIMIT);
  }
}

function different(path: string, expected: DevValue | undefined, actual: DevValue | undefined): DevDifference {
  return { path: bounded(printable(path), 256), expected: excerpt(expected), actual: excerpt(actual) };
}
function scalar(path: string, expected: unknown, actual: unknown): DevDifference | undefined {
  return expected === actual ? undefined : { path: bounded(printable(path), 256), expected: quoted(expected), actual: quoted(actual) };
}
function fields(expected: { key: string; value: DevValue }[], actual: { key: string; value: DevValue }[], path: string, epsilon: number | undefined): DevDifference | undefined {
  const left = new Map(expected.map(entry => [entry.key, entry.value]));
  const right = new Map(actual.map(entry => [entry.key, entry.value]));
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const difference = first(left.get(key), right.get(key), property(path, key), epsilon);
    if (difference) return difference;
  }
}
function first(expected: DevValue | undefined, actual: DevValue | undefined, path: string, epsilon: number | undefined): DevDifference | undefined {
  if (!expected || !actual || expected.kind !== actual.kind) return different(path, expected, actual);
  // Every numeric decision, including adapted payloads, uses this same comparison.
  if (expected.kind === "number" && actual.kind === "number") return expected.value === actual.value || (epsilon !== undefined && Math.abs(expected.value - actual.value) <= epsilon) ? undefined : different(path, expected, actual);
  if (expected.kind === "array" && actual.kind === "array") {
    for (let index = 0; index < Math.max(expected.items.length, actual.items.length); index++) {
      const difference = first(expected.items[index], actual.items[index], `${path}[${index}]`, epsilon);
      if (difference) return difference;
    }
    return;
  }
  if (expected.kind === "record" && actual.kind === "record") return fields(expected.entries, actual.entries, path, epsilon);
  if (expected.kind === "error" && actual.kind === "error") return scalar(`${path}.name`, expected.name, actual.name) ?? scalar(`${path}.message`, expected.message, actual.message) ?? fields(expected.fields, actual.fields, path, epsilon);
  if (expected.kind === "adapted" && actual.kind === "adapted") return scalar(`${path}.adapterId`, expected.adapterId, actual.adapterId) ?? scalar(`${path}.version`, expected.version, actual.version) ?? first(expected.payload, actual.payload, `${path}.payload`, epsilon);
  if (expected.kind === "bytes" && actual.kind === "bytes" && expected.type !== actual.type) return scalar(`${path}.type`, expected.type, actual.type);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return different(path, expected, actual);
}

/** Both sides are validated completely before even a short excerpt can be rendered. */
export function diffDevValues(expected: unknown, actual: unknown, comparison: Comparison = "exact", path = "$"): DevDifference | undefined {
  const left = validateDevValue(expected), right = validateDevValue(actual);
  const epsilon = comparison === "exact" ? undefined : comparison.epsilon;
  if (epsilon !== undefined && (!Number.isFinite(epsilon) || epsilon < 0)) throw new Error("INVALID_COMPARISON");
  return first(left, right, path, epsilon);
}

export function diffDevCompletions(expected: DevCompletion, actual: DevCompletion, comparison: Comparison = "exact"): DevDifference | undefined {
  // Validate even when the completion kind alone already differs.
  const valueDifference = diffDevValues(expected.value, actual.value, comparison, "$.value");
  return scalar("$.kind", expected.kind, actual.kind) ?? valueDifference;
}

function identity(context: Identity): string {
  try {
    const text = `${context.locator.module}#${context.locator.namePath.join(".")} realm=${context.environment} case=${context.caseId}`;
    assertDevSafe(text);
    return bounded(printable(text), 700);
  } catch { return "<identity unavailable>"; }
}
function details(difference: DevDifference): string {
  return `path ${difference.path}; expected ${difference.expected}; actual ${difference.actual}`;
}

export function describeDevCompletionDifference(artifact: Identity & Pick<DevCase, "completion" | "comparison">, actual: { kind: "return" | "throw"; value: unknown }, codec: DevCodecOptions = {}): string | undefined {
  const prefix = `OUTPUT_MISMATCH ${identity(artifact)}; ${artifact.completion.kind} -> ${actual.kind}`;
  try {
    const difference = diffDevCompletions(artifact.completion, { kind: actual.kind, value: encodeDevValue(actual.value, codec) }, artifact.comparison);
    return difference ? `${prefix}; ${details(difference)}` : undefined;
  } catch {
    return `${prefix}; path $.value; value unavailable (unsupported or sensitive value)`;
  }
}

/** Effect inputs remain exact: output tolerance must not silently change replay inputs. */
export function describeDevTraceDifference(context: Identity, input: DevTraceDifference | undefined): string {
  const prefix = `EFFECT_TRACE_MISMATCH ${identity(context)}`;
  try {
    if (!input || !Number.isSafeInteger(input.index) || input.index < 0) return `${prefix}; effect detail unavailable`;
    const expected = input.expected, actual = input.actual;
    const operation = expected?.kind === "call" ? expected.operation : actual?.operation;
    if (operation !== undefined) assertDevSafe(operation);
    if (actual) assertDevSafe(actual.operation);
    const location = `${prefix}; trace[${input.index}]${operation ? ` operation ${bounded(printable(operation), 80)}` : ""}`;
    // Do not print either side if the new effect inputs cannot pass the codec.
    if (input.reason === "unrenderable") return `${location}; arguments unavailable (unsupported or sensitive value)`;
    if (expected?.kind === "call") validateDevValue(expected.arguments);
    if (actual?.arguments) validateDevValue(actual.arguments);
    if (input.reason === "missing") return `${location}; missing effect${expected && expected.kind !== "call" ? " settlement" : ""}`;
    if (input.reason === "additional") return `${location}; additional effect`;
    if (expected?.kind === "call" && actual) {
      if (expected.operation !== actual.operation) return `${location}; expected operation ${bounded(printable(expected.operation), 80)}; actual operation ${bounded(printable(actual.operation), 80)}`;
      const difference = diffDevValues(expected.arguments, actual.arguments, "exact", "$.arguments");
      if (difference) return `${location}; ${details(difference)}`;
    }
    return `${location}; effect order or settlement differs`;
  } catch { return `${prefix}; effect values unavailable (unsupported or sensitive value)`; }
}
