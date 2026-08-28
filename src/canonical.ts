import { types as utilTypes } from "node:util";
import type { ValueAdapterRegistry } from "./adapters.js";

export type BuiltInValue = null | boolean | string | number | BuiltInValue[] | BuiltInRecord;

export interface BuiltInRecord {
  [key: string]: BuiltInValue;
}

export interface CanonicalNullNode {
  kind: "null";
}

export interface CanonicalBooleanNode {
  kind: "boolean";
  value: boolean;
}

export interface CanonicalStringNode {
  kind: "string";
  value: string;
}

export interface CanonicalNumberNode {
  kind: "number";
  value: number;
}

export interface CanonicalArrayNode<Extension extends CanonicalNodeExtension = never> {
  kind: "array";
  items: CanonicalValueNode<Extension>[];
}

export interface CanonicalRecordEntry<Extension extends CanonicalNodeExtension = never> {
  key: string;
  value: CanonicalValueNode<Extension>;
}

export interface CanonicalRecordNode<Extension extends CanonicalNodeExtension = never> {
  kind: "record";
  entries: CanonicalRecordEntry<Extension>[];
}

export interface CanonicalAdaptedNode {
  kind: "adapted";
  adapterId: string;
  version: number;
  payload: CanonicalBuiltInValueNode;
}

/** A seam for durable typed nodes such as the later Value Adapter node. */
export interface CanonicalNodeExtension {
  kind: string;
}

export type CanonicalValueNode<Extension extends CanonicalNodeExtension = never> =
  | CanonicalNullNode
  | CanonicalBooleanNode
  | CanonicalStringNode
  | CanonicalNumberNode
  | CanonicalArrayNode<Extension>
  | CanonicalRecordNode<Extension>
  | Extension;

export type CanonicalBuiltInValueNode = CanonicalValueNode<never>;
export type CanonicalReplayValueNode = CanonicalValueNode<CanonicalAdaptedNode>;

export type StandardErrorName =
  | "Error"
  | "EvalError"
  | "RangeError"
  | "ReferenceError"
  | "SyntaxError"
  | "TypeError"
  | "URIError"
  | "AggregateError";

export interface CanonicalStandardErrorNode {
  kind: "standard-error";
  name: StandardErrorName;
  message: string;
}

export interface CanonicalReturnCompletion<Extension extends CanonicalNodeExtension = never> {
  kind: "return";
  value: CanonicalValueNode<Extension>;
}

export interface CanonicalThrowValueCompletion<Extension extends CanonicalNodeExtension = never> {
  kind: "throw";
  value: CanonicalValueNode<Extension>;
}

export interface CanonicalThrowErrorCompletion {
  kind: "throw";
  error: CanonicalStandardErrorNode;
}

export type CanonicalCompletion<Extension extends CanonicalNodeExtension = never> =
  | CanonicalReturnCompletion<Extension>
  | CanonicalThrowValueCompletion<Extension>
  | CanonicalThrowErrorCompletion;

export type ObservedCompletion =
  | { kind: "return"; value: unknown }
  | { kind: "throw"; value: unknown };

/** Resource limits used by observation safety. These are deliberately finite. */
export interface CanonicalLimits {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
}

export const DEFAULT_CANONICAL_LIMITS: CanonicalLimits = Object.freeze({
  maxDepth: 20,
  maxNodes: 10_000,
  maxBytes: 256 * 1024,
});

export interface CanonicalSnapshot<Extension extends CanonicalNodeExtension = never> {
  arguments: CanonicalArrayNode<Extension>;
  completion: CanonicalCompletion<Extension>;
}

export class UnsupportedValueError extends Error {
  readonly code:
    | "UNSUPPORTED_VALUE"
    | "CANONICAL_LIMIT"
    | "VALUE_ADAPTER_SERIALIZE_FAILED"
    | "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED" = "UNSUPPORTED_VALUE";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedValueError";
  }
}

export class ValueAdapterSerializationError extends UnsupportedValueError {
  readonly code = "VALUE_ADAPTER_SERIALIZE_FAILED" as const;

  constructor() {
    super("Value adapter serialization failed");
    this.name = "ValueAdapterSerializationError";
  }
}

export class ValueAdapterPayloadUnsupportedError extends UnsupportedValueError {
  readonly code = "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED" as const;

  constructor() {
    super("Value adapter payload is outside ReplayLock's built-in value model");
    this.name = "ValueAdapterPayloadUnsupportedError";
  }
}

export class CanonicalLimitError extends UnsupportedValueError {
  readonly code = "CANONICAL_LIMIT" as const;

  constructor(message: string) {
    super(message);
    this.name = "CanonicalLimitError";
  }
}

const standardErrorPrototypes = new Map<object, StandardErrorName>([
  [Error.prototype, "Error"],
  [EvalError.prototype, "EvalError"],
  [RangeError.prototype, "RangeError"],
  [ReferenceError.prototype, "ReferenceError"],
  [SyntaxError.prototype, "SyntaxError"],
  [TypeError.prototype, "TypeError"],
  [URIError.prototype, "URIError"],
  [AggregateError.prototype, "AggregateError"],
]);

const standardErrorConstructors: Record<
  StandardErrorName,
  (message: string) => Error
> = {
  Error: (message) => new Error(message),
  EvalError: (message) => new EvalError(message),
  RangeError: (message) => new RangeError(message),
  ReferenceError: (message) => new ReferenceError(message),
  SyntaxError: (message) => new SyntaxError(message),
  TypeError: (message) => new TypeError(message),
  URIError: (message) => new URIError(message),
  AggregateError: (message) => new AggregateError([], message),
};

export function encodeCanonicalValue(
  value: unknown,
  limits: Partial<CanonicalLimits> = {},
  adapters?: ValueAdapterRegistry,
): CanonicalReplayValueNode {
  const resolved = resolveCanonicalLimits(limits);
  const budget: EncodingBudget = { limits: resolved, nodes: 0 };
  const encoded = encodeValue(value, new WeakSet<object>(), adapters, true, budget, 0);
  enforceCanonicalLimits(encoded, resolved);
  if (Buffer.byteLength(JSON.stringify(encoded), "utf8") > resolved.maxBytes) {
    throw new CanonicalLimitError("Canonical value exceeds byte limit");
  }
  return encoded;
}

export function decodeCanonicalValue(value: unknown, adapters?: ValueAdapterRegistry): unknown {
  return decodeValue(value, new WeakSet<object>(), adapters);
}

export function encodeCanonicalCompletion(
  completion: ObservedCompletion,
  adapters?: ValueAdapterRegistry,
): CanonicalCompletion<CanonicalAdaptedNode> {
  const resolved = resolveCanonicalLimits({});
  const budget: EncodingBudget = { limits: resolved, nodes: 0 };
  const encoded = encodeCompletion(completion, new WeakSet<object>(), adapters, budget, 0);
  enforceCanonicalLimits(encoded, resolved);
  if (Buffer.byteLength(JSON.stringify(encoded), "utf8") > resolved.maxBytes) {
    throw new CanonicalLimitError("Canonical completion exceeds byte limit");
  }
  return encoded;
}

/** Encode one observed call with one identity scope spanning all arguments and its completion. */
export function encodeCanonicalSnapshot(
  arguments_: readonly unknown[],
  completion: ObservedCompletion,
  limits: Partial<CanonicalLimits> = {},
  adapters?: ValueAdapterRegistry,
): CanonicalSnapshot<CanonicalAdaptedNode> {
  if (utilTypes.isProxy(arguments_) || !Array.isArray(arguments_)) {
    throw new UnsupportedValueError("Snapshot arguments must be an ordinary dense array");
  }
  if (!isCompletionInput(completion)) {
    throw new UnsupportedValueError("Completion must be a return or synchronous throw");
  }

  const resolved = resolveCanonicalLimits(limits);
  const budget: EncodingBudget = { limits: resolved, nodes: 0 };
  const seen = new WeakSet<object>();
  seen.add(arguments_);
  consumeEncodingBudget(budget, 0);
  const canonicalArguments = encodeArray(arguments_ as unknown[], seen, adapters, true, budget, 0);
  if (seen.has(completion)) {
    throw new UnsupportedValueError("Snapshot aliases are unsupported");
  }
  seen.add(completion);
  const snapshot = {
    arguments: canonicalArguments,
    completion: encodeCompletion(completion, seen, adapters, budget, 0),
  };
  enforceCanonicalLimitsMany([snapshot.arguments, snapshot.completion], resolved);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  const maxBytes = resolved.maxBytes;
  if (bytes > maxBytes) throw new CanonicalLimitError("Canonical observation exceeds byte limit");
  return snapshot;
}

interface EncodingBudget {
  readonly limits: CanonicalLimits;
  nodes: number;
}

function consumeEncodingBudget(budget: EncodingBudget, depth: number): void {
  if (depth > budget.limits.maxDepth) {
    throw new CanonicalLimitError("Canonical value exceeds depth limit");
  }
  budget.nodes += 1;
  if (budget.nodes > budget.limits.maxNodes) {
    throw new CanonicalLimitError("Canonical value exceeds node limit");
  }
}

function resolveCanonicalLimits(limits: Partial<CanonicalLimits>): CanonicalLimits {
  const resolved = {
    maxDepth: limits.maxDepth ?? DEFAULT_CANONICAL_LIMITS.maxDepth,
    maxNodes: limits.maxNodes ?? DEFAULT_CANONICAL_LIMITS.maxNodes,
    maxBytes: limits.maxBytes ?? DEFAULT_CANONICAL_LIMITS.maxBytes,
  };
  if (
    !Number.isSafeInteger(resolved.maxDepth) || resolved.maxDepth < 0 ||
    !Number.isSafeInteger(resolved.maxNodes) || resolved.maxNodes < 1 ||
    !Number.isSafeInteger(resolved.maxBytes) || resolved.maxBytes < 1
  ) throw new RangeError("Canonical limits must be positive safe integers");
  return resolved;
}

function enforceCanonicalLimits(value: unknown, limits: CanonicalLimits): void {
  enforceCanonicalLimitsMany([value], limits);
}

function enforceCanonicalLimitsMany(values: readonly unknown[], limits: CanonicalLimits): void {
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") return;
    // Only typed canonical nodes consume the visited-node budget. Their
    // `items` and `entries` containers are representation detail, not values.
    if (!Object.hasOwn(node, "kind")) {
      if (Array.isArray(node)) for (const item of node) visit(item, depth);
      else if (Object.hasOwn(node, "value")) visit((node as { value: unknown }).value, depth);
      return;
    }
    if (depth > limits.maxDepth) throw new CanonicalLimitError("Canonical value exceeds depth limit");
    nodes += 1;
    if (nodes > limits.maxNodes) throw new CanonicalLimitError("Canonical value exceeds node limit");
    const kind = (node as { kind: unknown }).kind;
    if (kind === "array") visit((node as { items: unknown }).items, depth + 1);
    else if (kind === "record") visit((node as { entries: unknown }).entries, depth + 1);
    else if (kind === "adapted") visit((node as { payload: unknown }).payload, depth + 1);
    else if (kind === "return" || kind === "throw") {
      if (Object.hasOwn(node, "value")) visit((node as { value: unknown }).value, depth + 1);
      if (Object.hasOwn(node, "error")) visit((node as { error: unknown }).error, depth + 1);
    }
  };
  for (const value of values) visit(value, 0);
}

function encodeCompletion(
  completion: ObservedCompletion,
  seen: WeakSet<object>,
  adapters?: ValueAdapterRegistry,
  budget: EncodingBudget = { limits: DEFAULT_CANONICAL_LIMITS, nodes: 0 },
  depth = 0,
): CanonicalCompletion<CanonicalAdaptedNode> {
  if (!isCompletionInput(completion)) {
    throw new UnsupportedValueError("Completion must be a return or synchronous throw");
  }

  consumeEncodingBudget(budget, depth);
  const kind = ownDataValue(completion, "kind");
  if (kind === "return") {
    return { kind: "return", value: encodeValue(ownDataValue(completion, "value"), seen, adapters, true, budget, depth + 1) };
  }

  const completionValue = ownDataValue(completion, "value");
  const error = encodeStandardError(completionValue);
  if (error === undefined) return { kind: "throw", value: encodeValue(completionValue, seen, adapters, true, budget, depth + 1) };
  if (typeof completionValue === "object" && completionValue !== null) {
    if (seen.has(completionValue)) throw new UnsupportedValueError("Snapshot aliases are unsupported");
    seen.add(completionValue);
  }
  return { kind: "throw", error };
}

export function decodeCanonicalCompletion(value: unknown, adapters?: ValueAdapterRegistry): ObservedCompletion {
  if (!isDataObject(value)) throw malformedCanonical("completion");
  const keys = ownEnumerableDataKeys(value);
  const kind = ownDataValue(value, "kind");
  if (kind === "return" && sameKeys(keys, ["kind", "value"])) {
    return { kind: "return", value: decodeCanonicalValue(ownDataValue(value, "value"), adapters) };
  }
  if (kind === "throw" && sameKeys(keys, ["kind", "value"])) {
    return { kind: "throw", value: decodeCanonicalValue(ownDataValue(value, "value"), adapters) };
  }
  if (kind === "throw" && sameKeys(keys, ["error", "kind"])) {
    const error = decodeStandardError(ownDataValue(value, "error"));
    return { kind: "throw", value: standardErrorConstructors[error.name](error.message) };
  }
  throw malformedCanonical("completion");
}

export function canonicalValueJson(value: CanonicalReplayValueNode): string {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function canonicalCompletionJson(value: CanonicalCompletion): string {
  return JSON.stringify(normalizeCanonicalCompletion(value));
}

export function canonicalValueBytes(value: CanonicalBuiltInValueNode): Buffer {
  return Buffer.from(canonicalValueJson(value), "utf8");
}

export function canonicalCompletionBytes(value: CanonicalCompletion): Buffer {
  return Buffer.from(canonicalCompletionJson(value), "utf8");
}

export function canonicalValuesEqual(
  left: CanonicalBuiltInValueNode,
  right: CanonicalBuiltInValueNode,
): boolean {
  return canonicalValueJson(left) === canonicalValueJson(right);
}

export function canonicalCompletionsEqual(
  left: CanonicalCompletion,
  right: CanonicalCompletion,
): boolean {
  return canonicalCompletionJson(left) === canonicalCompletionJson(right);
}

function encodeValue(
  value: unknown,
  seen: WeakSet<object>,
  adapters: ValueAdapterRegistry | undefined,
  allowAdapters: boolean,
  budget: EncodingBudget,
  depth: number,
): CanonicalReplayValueNode {
  consumeEncodingBudget(budget, depth);
  if (utilTypes.isProxy(value)) throw new UnsupportedValueError("Proxies are unsupported");
  if (value === null) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new UnsupportedValueError("Only finite numbers other than negative zero are supported");
    }
    return { kind: "number", value };
  }
  if (typeof value !== "object") throw new UnsupportedValueError("Unsupported value category");
  if (seen.has(value)) throw new UnsupportedValueError("Cycles and repeated references are unsupported");
  seen.add(value);

  const adapter = allowAdapters ? adapters?.findForValue(value) : undefined;
  if (adapter) {
    let payload: unknown;
    try {
      payload = adapter.serialize(value);
    } catch {
      throw new ValueAdapterSerializationError();
    }
    try {
      return {
        kind: "adapted",
        adapterId: adapter.id,
        version: adapter.version,
        payload: encodeValue(payload, seen, undefined, false, budget, depth + 1) as CanonicalBuiltInValueNode,
      };
    } catch (error) {
      if (error instanceof CanonicalLimitError) throw error;
      if (error instanceof UnsupportedValueError) {
        throw new ValueAdapterPayloadUnsupportedError();
      }
      throw error;
    }
  }

  if (Array.isArray(value)) return encodeArray(value, seen, adapters, allowAdapters, budget, depth);
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new UnsupportedValueError("Only ordinary plain records are supported");
  }
  return encodeRecord(value, seen, adapters, allowAdapters, budget, depth);
}

function encodeArray(value: unknown[], seen: WeakSet<object>, adapters: ValueAdapterRegistry | undefined, allowAdapters: boolean, budget: EncodingBudget, depth: number): CanonicalArrayNode<CanonicalAdaptedNode> {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new UnsupportedValueError("Only ordinary dense arrays are supported");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors["length"];
  if (!isStandardArrayLengthDescriptor(lengthDescriptor)) {
    throw new UnsupportedValueError("Array length must be a standard data property");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new UnsupportedValueError("Array symbol properties are unsupported");
  }
  const expectedKeys: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    expectedKeys.push(String(index));
  }
  expectedKeys.push("length");
  if (!sameKeys([...(keys as string[])].sort(), [...expectedKeys].sort())) {
    throw new UnsupportedValueError("Sparse arrays and array properties are unsupported");
  }
  const items: CanonicalReplayValueNode[] = [];
  for (const key of expectedKeys) {
    if (key === "length") break;
    const descriptor = descriptors[key];
    if (!isStandardDataDescriptor(descriptor)) {
      throw new UnsupportedValueError("Array elements must be standard data properties");
    }
    items.push(encodeValue(descriptor.value, seen, adapters, allowAdapters, budget, depth + 1));
  }
  return { kind: "array", items };
}

function encodeRecord(value: object, seen: WeakSet<object>, adapters: ValueAdapterRegistry | undefined, allowAdapters: boolean, budget: EncodingBudget, depth: number): CanonicalRecordNode<CanonicalAdaptedNode> {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new UnsupportedValueError("Record symbol properties are unsupported");
  }
  const stringKeys = keys as string[];
  stringKeys.sort();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = stringKeys.map((key) => {
    const descriptor = descriptors[key];
    if (!isStandardDataDescriptor(descriptor)) {
      throw new UnsupportedValueError("Record fields must be standard data properties");
    }
    return { key, value: encodeValue(descriptor.value, seen, adapters, allowAdapters, budget, depth + 1) };
  });
  return { kind: "record", entries };
}

function decodeValue(value: unknown, seen: WeakSet<object>, adapters?: ValueAdapterRegistry): unknown {
  if (!isDataObject(value)) throw malformedCanonical("value");
  if (seen.has(value)) throw malformedCanonical("value identity");
  seen.add(value);
  const keys = ownEnumerableDataKeys(value);
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (!isStandardDataDescriptor(kindDescriptor) || typeof kindDescriptor.value !== "string") {
    throw malformedCanonical("value");
  }
  const kind = kindDescriptor.value;
  switch (kind) {
    case "null":
      if (!sameKeys(keys, ["kind"])) throw malformedCanonical("null node");
      return null;
    case "boolean":
      if (!sameKeys(keys, ["kind", "value"])) {
        throw malformedCanonical("boolean node");
      }
      const booleanValue = ownDataValue(value, "value");
      if (typeof booleanValue !== "boolean") throw malformedCanonical("boolean node");
      return booleanValue;
    case "string":
      if (!sameKeys(keys, ["kind", "value"])) {
        throw malformedCanonical("string node");
      }
      const stringValue = ownDataValue(value, "value");
      if (typeof stringValue !== "string") throw malformedCanonical("string node");
      return stringValue;
    case "number":
      if (!sameKeys(keys, ["kind", "value"])) {
        throw malformedCanonical("number node");
      }
      const numberValue = ownDataValue(value, "value");
      if (
        typeof numberValue !== "number" ||
        !Number.isFinite(numberValue) ||
        Object.is(numberValue, -0)
      ) {
        throw malformedCanonical("number node");
      }
      return numberValue;
    case "array":
      if (!sameKeys(keys, ["items", "kind"])) {
        throw malformedCanonical("array node");
      }
      const arrayItems = ownDataValue(value, "items");
      if (utilTypes.isProxy(arrayItems) || !Array.isArray(arrayItems)) {
        throw malformedCanonical("array node");
      }
      if (seen.has(arrayItems)) throw malformedCanonical("array node identity");
      seen.add(arrayItems);
      const decodedItems: BuiltInValue[] = [];
      const validatedItems = decodeCanonicalArray(arrayItems, "array node");
      for (let index = 0; index < validatedItems.length; index += 1) {
        decodedItems.push(decodeValue(validatedItems[index], seen, adapters) as BuiltInValue);
      }
      return decodedItems;
    case "record": {
      if (!sameKeys(keys, ["entries", "kind"])) {
        throw malformedCanonical("record node");
      }
      const recordEntries = ownDataValue(value, "entries");
      if (utilTypes.isProxy(recordEntries) || !Array.isArray(recordEntries)) {
        throw malformedCanonical("record node");
      }
      if (seen.has(recordEntries)) throw malformedCanonical("record node identity");
      seen.add(recordEntries);
      const record: BuiltInRecord = {};
      let previousKey: string | undefined;
      const validatedEntries = decodeCanonicalArray(recordEntries, "record node");
      for (let index = 0; index < validatedEntries.length; index += 1) {
        const entry = validatedEntries[index];
        if (
          !isDataObject(entry) ||
          seen.has(entry) ||
          !sameKeys(ownEnumerableDataKeys(entry), ["key", "value"]) ||
          typeof ownDataValue(entry, "key") !== "string"
        ) {
          throw malformedCanonical("record entry");
        }
        seen.add(entry);
        const entryKey = ownDataValue(entry, "key");
        if (typeof entryKey !== "string" || (previousKey !== undefined && entryKey <= previousKey)) {
          throw malformedCanonical("record entry");
        }
        Object.defineProperty(record, entryKey, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: decodeValue(ownDataValue(entry, "value"), seen, adapters) as BuiltInValue,
        });
        previousKey = entryKey;
      }
      return record;
    }
    case "adapted": {
      if (!sameKeys(keys, ["adapterId", "kind", "payload", "version"])) {
        throw malformedCanonical("adapted node");
      }
      const adapterId = ownDataValue(value, "adapterId");
      const version = ownDataValue(value, "version");
      if (typeof adapterId !== "string" || !Number.isInteger(version)) {
        throw malformedCanonical("adapted node");
      }
      const adapter = adapters?.findById(adapterId);
      if (!adapter || adapter.version !== version) throw malformedCanonical("adapted adapter");
      const payload = decodeValue(ownDataValue(value, "payload"), seen, undefined);
      return adapter.deserialize(payload);
    }
    default:
      throw malformedCanonical("value kind");
  }
}

function decodeCanonicalArray(value: unknown[], subject: string): unknown[] {
  if (utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw malformedCanonical(subject);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors["length"];
  if (!isStandardArrayLengthDescriptor(lengthDescriptor)) throw malformedCanonical(subject);
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length > 0xffffffff) throw malformedCanonical(subject);

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) {
    throw malformedCanonical(subject);
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!isStandardDataDescriptor(descriptor)) throw malformedCanonical(subject);
  }
  return value;
}

function encodeStandardError(value: unknown): CanonicalStandardErrorNode | undefined {
  if (utilTypes.isProxy(value)) return undefined;
  if (typeof value !== "object" || value === null) return undefined;
  const name = standardErrorPrototypes.get(Object.getPrototypeOf(value));
  if (name === undefined) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new UnsupportedValueError("Standard error symbols are unsupported");
    const descriptor = descriptors[key];
    if (descriptor === undefined) throw new UnsupportedValueError("Malformed standard error");
    if (key === "stack") {
      if (
        !("get" in descriptor) &&
        (!("value" in descriptor) || typeof descriptor.value !== "string")
      ) {
        throw new UnsupportedValueError("A standard error stack must be a string or accessor");
      }
      continue;
    }
    if (key === "message" || (name === "AggregateError" && key === "errors")) continue;
    throw new UnsupportedValueError("Standard error properties are unsupported");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "message");
  if (descriptor === undefined) return { kind: "standard-error", name, message: "" };
  if (!("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new UnsupportedValueError("A standard error message must be a string data property");
  }
  return { kind: "standard-error", name, message: descriptor.value };
}

function isCompletionInput(value: unknown): value is ObservedCompletion {
  if (!isDataObject(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = ownEnumerableDataKeys(value);
  if (!sameKeys(keys, ["kind", "value"])) return false;
  const kind = ownDataValue(value, "kind");
  return kind === "return" || kind === "throw";
}

function decodeStandardError(value: unknown): CanonicalStandardErrorNode {
  if (!isDataObject(value)) throw malformedCanonical("standard error node");
  const keys = ownEnumerableDataKeys(value);
  const kind = ownDataValue(value, "kind");
  const name = ownDataValue(value, "name");
  const message = ownDataValue(value, "message");
  if (
    !sameKeys(keys, ["kind", "message", "name"]) ||
    kind !== "standard-error" ||
    !isStandardErrorName(name) ||
    typeof message !== "string"
  ) {
    throw malformedCanonical("standard error node");
  }
  return { kind: "standard-error", name, message };
}

function normalizeCanonicalValue(value: unknown): CanonicalBuiltInValueNode {
  return encodeCanonicalValue(decodeCanonicalValue(value)) as CanonicalBuiltInValueNode;
}

function normalizeCanonicalCompletion(value: unknown): CanonicalCompletion {
  return encodeCanonicalCompletion(decodeCanonicalCompletion(value)) as CanonicalCompletion;
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  return !utilTypes.isProxy(value) && typeof value === "object" && value !== null;
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isStandardDataDescriptor(descriptor)) throw malformedCanonical("node property");
  return descriptor.value;
}

function ownEnumerableDataKeys(value: object): string[] {
  if (Object.getPrototypeOf(value) !== Object.prototype) throw malformedCanonical("node prototype");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw malformedCanonical("node keys");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    if (!isStandardDataDescriptor(descriptors[key])) throw malformedCanonical("node property");
  }
  return (keys as string[]).sort();
}

function isStandardDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.configurable === true &&
    descriptor.enumerable === true &&
    descriptor.writable === true
  );
}

function isStandardArrayLengthDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: number } {
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.value === Math.trunc(descriptor.value) &&
    descriptor.value >= 0 &&
    descriptor.value <= 0xffffffff &&
    descriptor.configurable === false &&
    descriptor.enumerable === false &&
    descriptor.writable === true
  );
}

function sameKeys(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((key, index) => key === sortedExpected[index]);
}

function isStandardErrorName(value: unknown): value is StandardErrorName {
  return typeof value === "string" && Object.hasOwn(standardErrorConstructors, value);
}

function malformedCanonical(subject: string): UnsupportedValueError {
  return new UnsupportedValueError(`Malformed canonical ${subject}`);
}
