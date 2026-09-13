import type { DevAdapter, DevCodecOptions, DevValue } from "./dev-contract.js";

/** Limits apply before any persistence or content-derived identity is possible. */
export const DEV_VALUE_LIMITS = Object.freeze({ depth: 20, nodes: 10_000, bytes: 256 * 1024 });

const codedErrors = new WeakSet<object>();
export function devValueError(code: string): Error & { code: string } {
  const error = Object.assign(new Error(code), { code });
  codedErrors.add(error);
  return error;
}
function fail(code = "UNSUPPORTED_VALUE"): never { throw devValueError(code); }
function coded<T>(invoke: () => T): T {
  try { return invoke(); }
  catch (error) {
    if (error && typeof error === "object" && codedErrors.has(error)) throw error;
    return fail();
  }
}
const secretKey = /(?:password|passwd|passphrase|secret|apikey|accesstoken|refreshtoken|authorization|cookie|privatekey|credential)/i;
function safeKey(key: string): void {
  safeString(key);
  if (secretKey.test(key.replace(/[^a-z0-9]/gi, ""))) fail("SENSITIVE_VALUE");
}
function safeString(value: string): void {
  if (value.length > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
  if (/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|gh[pousr]_|github_pat_|\bsk-|sk_live_|rk_live_|xox[bpars]-|\b(?:basic|bearer)\s+\S+/i.test(value) ||
      /(?:password|passwd|passphrase|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|private[_ -]?key)["']?\s*[:=]\s*["']?[^\s"'&,}]+/i.test(value) ||
      /https?:\/\/[^/\s]+:[^/\s]+@/i.test(value) ||
      /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) fail("SENSITIVE_VALUE");
}

const errorTypes = new Map<object, string>([
  [Error.prototype, "Error"], [TypeError.prototype, "TypeError"], [RangeError.prototype, "RangeError"],
  [SyntaxError.prototype, "SyntaxError"], [ReferenceError.prototype, "ReferenceError"],
  [URIError.prototype, "URIError"], [EvalError.prototype, "EvalError"], [AggregateError.prototype, "AggregateError"],
]);
const errorFactories: Record<string, (message: string) => Error> = {
  Error: m => new Error(m), TypeError: m => new TypeError(m), RangeError: m => new RangeError(m),
  SyntaxError: m => new SyntaxError(m), ReferenceError: m => new ReferenceError(m),
  URIError: m => new URIError(m), EvalError: m => new EvalError(m), AggregateError: m => new AggregateError([], m),
};
// Access Buffer only through the host global; browser bundles contain no Node dependency.
function bufferType(): { prototype: object; from(value: Uint8Array): Uint8Array } | undefined {
  return (globalThis as typeof globalThis & { Buffer?: { prototype: object; from(value: Uint8Array): Uint8Array } }).Buffer;
}
function data(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}
function keys(value: object): string[] {
  const result = Reflect.ownKeys(value);
  if (result.some(key => typeof key !== "string")) fail();
  if (result.length > DEV_VALUE_LIMITS.nodes) fail("OVERSIZED_OBSERVATION");
  return (result as string[]).sort();
}
function dense(value: unknown, mutability: "mutable" | "readonly" = "mutable"): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = data(value, "length") as number;
  if (mutability === "mutable" && !Object.getOwnPropertyDescriptor(value, "length")!.writable) fail();
  if (length > DEV_VALUE_LIMITS.nodes) fail("OVERSIZED_OBSERVATION");
  if (keys(value).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        (mutability === "mutable" && (!descriptor.configurable || !descriptor.writable))) fail();
    return descriptor.value;
  });
}
function bytesSafe(bytes: Uint8Array): void {
  if (bytes.byteLength > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
  safeString(new TextDecoder().decode(bytes));
  safeString(new TextDecoder("utf-16le").decode(bytes));
  safeString(new TextDecoder("utf-16be").decode(bytes));
}
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function unbase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
  const result = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (base64(result) !== value) fail();
  bytesSafe(result);
  return result;
}
function byteBudget(): (value: string | number) => void {
  let bytes = 0;
  return value => {
    bytes += typeof value === "number" ? value : new TextEncoder().encode(value).length;
    if (bytes > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
  };
}

export function validateDevAdapters(adapters: readonly DevAdapter[]): readonly DevAdapter[] {
  return coded(() => validateAdapters(adapters));
}
function validateAdapters(adapters: readonly DevAdapter[]): readonly DevAdapter[] {
  const ids = new Set<string>();
  const prototypes = new Set<object>();
  // Configuration registries are often frozen by the public defineReplayLock helper.
  // Their mutability is not part of the captured value model.
  for (const candidate of dense(adapters, "readonly")) {
    if (!candidate || typeof candidate !== "object") fail("VALUE_ADAPTER_DEFINITION_INVALID");
    const id = data(candidate, "id"), version = data(candidate, "version"), type = data(candidate, "type");
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(id) ||
        !Number.isSafeInteger(version) || (version as number) < 1 || !type ||
        (typeof type !== "function" && typeof type !== "object") ||
        typeof data(candidate, "serialize") !== "function" || typeof data(candidate, "deserialize") !== "function") fail("VALUE_ADAPTER_DEFINITION_INVALID");
    safeString(id);
    const prototype = data(type, "prototype");
    if (!prototype || typeof prototype !== "object" ||
        [Object.prototype, Array.prototype, Date.prototype, Uint8Array.prototype, ArrayBuffer.prototype, bufferType()?.prototype].includes(prototype) || errorTypes.has(prototype)) fail("VALUE_ADAPTER_DEFINITION_INVALID");
    if (ids.has(id) || prototypes.has(prototype)) fail("VALUE_ADAPTER_DEFINITION_INVALID");
    ids.add(id); prototypes.add(prototype);
  }
  return adapters;
}

export function encodeDevValue(value: unknown, options: DevCodecOptions = {}): DevValue {
  return coded(() => encode(value, options));
}
function encode(value: unknown, options: DevCodecOptions): DevValue {
  const adapters = validateDevAdapters(options.adapters ?? []);
  let nodes = 0;
  const charge = byteBudget();
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number, allowAdapter = true): DevValue => {
    if (++nodes > DEV_VALUE_LIMITS.nodes || depth > DEV_VALUE_LIMITS.depth) fail("OVERSIZED_OBSERVATION");
    charge(8);
    if (options.isProxy?.(value)) fail();
    if (value === undefined) return { kind: "undefined" };
    if (value === null) return { kind: "null" };
    if (typeof value === "boolean") return { kind: "boolean", value };
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) fail();
      return { kind: "number", value };
    }
    if (typeof value === "string") { safeString(value); charge(JSON.stringify(value)); return { kind: "string", value }; }
    if (typeof value !== "object" || seen.has(value)) fail();
    seen.add(value);
    const prototype: object | null = Object.getPrototypeOf(value);
    const adapter = allowAdapter ? adapters.find(a => a.type.prototype === prototype) : undefined;
    if (adapter) {
      charge(adapter.id);
      let payload: unknown;
      try { payload = adapter.serialize(value); } catch { fail("VALUE_ADAPTER_SERIALIZE_FAILED"); }
      return { kind: "adapted", adapterId: adapter.id, version: adapter.version, payload: visit(payload, depth + 1, false) };
    }
    if (Array.isArray(value)) return { kind: "array", items: dense(value).map(v => visit(v, depth + 1, allowAdapter)) };
    if (prototype === Date.prototype) {
      if (keys(value).length) fail();
      const time = Date.prototype.getTime.call(value);
      if (!Number.isFinite(time)) fail();
      return { kind: "date", value: Date.prototype.toISOString.call(value) };
    }
    if (prototype === ArrayBuffer.prototype || prototype === Uint8Array.prototype || prototype === bufferType()?.prototype) {
      const type = prototype === ArrayBuffer.prototype ? "ArrayBuffer" : prototype === Uint8Array.prototype ? "Uint8Array" : "Buffer";
      const native = type === "ArrayBuffer" ? ArrayBuffer.prototype : Object.getPrototypeOf(Uint8Array.prototype) as object;
      const get = (key: string): unknown => Object.getOwnPropertyDescriptor(native, key)!.get!.call(value);
      const length = get("byteLength") as number;
      if (length > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
      // Byte indices are payload bytes, not individual canonical nodes.
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== (type === "ArrayBuffer" ? 0 : length) || ownKeys.some((key, index) => key !== String(index))) fail();
      const buffer = type === "ArrayBuffer" ? value as ArrayBuffer : get("buffer") as ArrayBuffer;
      // A shared/resizable backing store cannot provide an atomic value snapshot.
      if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get?.call(buffer)) fail();
      const bytes = new Uint8Array(buffer, type === "ArrayBuffer" ? 0 : get("byteOffset") as number, length);
      bytesSafe(bytes);
      const encoded = base64(bytes); charge(encoded);
      return { kind: "bytes", type, value: encoded };
    }
    const errorName = prototype && errorTypes.get(prototype);
    if (errorName) {
      const message = Object.hasOwn(value, "message") ? data(value, "message") : "";
      if (typeof message !== "string") fail();
      safeString(message);
      charge(JSON.stringify(message));
      const fields = keys(value).filter(key => key !== "stack" && key !== "message").map(key => {
        if (key === "name") fail();
        safeKey(key);
        charge(JSON.stringify(key));
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!("value" in descriptor) || !descriptor.configurable || !descriptor.writable || descriptor.enumerable !== (key !== "cause" && key !== "errors")) fail();
        return { key, value: visit(descriptor.value, depth + 1, allowAdapter) };
      });
      return { kind: "error", name: errorName, message, fields };
    }
    if (prototype !== Object.prototype) fail();
    return { kind: "record", entries: keys(value).map(key => {
      safeKey(key);
      charge(JSON.stringify(key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) fail();
      return { key, value: visit(descriptor.value, depth + 1, allowAdapter) };
    }) };
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
  return result;
}

/** Validation never calls an adapter or a property getter. It returns a detached node. */
export function validateDevValue(value: unknown): DevValue {
  return coded(() => validate(value));
}
function validate(value: unknown): DevValue {
  let nodes = 0;
  const charge = byteBudget();
  const seen = new WeakSet<object>();
  const object = (value: unknown, expected: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value)) fail();
    seen.add(value);
    if (JSON.stringify(keys(value)) !== JSON.stringify(expected.sort())) fail();
    const copy: Record<string, unknown> = {};
    for (const key of expected) Object.defineProperty(copy, key, { value: data(value, key), enumerable: true });
    return copy;
  };
  const string = (value: unknown): string => { if (typeof value !== "string") fail(); safeString(value); charge(JSON.stringify(value)); return value; };
  const visit = (input: unknown, depth: number, allowAdapter = true): DevValue => {
    if (++nodes > DEV_VALUE_LIMITS.nodes || depth > DEV_VALUE_LIMITS.depth) fail("OVERSIZED_OBSERVATION");
    charge(8);
    if (!input || typeof input !== "object") fail();
    const kind = data(input, "kind");
    const fields = (input: unknown): { key: string; value: DevValue }[] => {
      let previous: string | undefined;
      return dense(input).map(entry => {
        const node = object(entry, ["key", "value"]);
        const key = string(node.key); safeKey(key);
        if (previous !== undefined && previous >= key) fail();
        previous = key;
        return { key, value: visit(node.value, depth + 1, allowAdapter) };
      });
    };
    switch (kind) {
      case "null": case "undefined": object(input, ["kind"]); return { kind };
      case "boolean": {
        const node = object(input, ["kind", "value"]); if (typeof node.value !== "boolean") fail(); return { kind, value: node.value };
      }
      case "number": {
        const node = object(input, ["kind", "value"]);
        if (typeof node.value !== "number" || !Number.isFinite(node.value) || Object.is(node.value, -0)) fail();
        return { kind, value: node.value };
      }
      case "string": return { kind, value: string(object(input, ["kind", "value"]).value) };
      case "date": {
        const value = string(object(input, ["kind", "value"]).value), date = new Date(value);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(); return { kind, value };
      }
      case "bytes": {
        const node = object(input, ["kind", "type", "value"]), value = string(node.value);
        if (node.type !== "ArrayBuffer" && node.type !== "Uint8Array" && node.type !== "Buffer") fail();
        unbase64(value); return { kind, type: node.type, value };
      }
      case "array": return { kind, items: dense(object(input, ["kind", "items"]).items).map(v => visit(v, depth + 1, allowAdapter)) };
      case "record": return { kind, entries: fields(object(input, ["kind", "entries"]).entries) };
      case "error": {
        const node = object(input, ["kind", "name", "message", "fields"]), name = string(node.name);
        if (!Object.hasOwn(errorFactories, name)) fail();
        const entries = fields(node.fields);
        if (entries.some(e => ["name", "stack", "message"].includes(e.key))) fail();
        return { kind, name, message: string(node.message), fields: entries };
      }
      case "adapted": {
        if (!allowAdapter) fail();
        const node = object(input, ["kind", "adapterId", "version", "payload"]), adapterId = string(node.adapterId);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(adapterId) || !Number.isSafeInteger(node.version) || (node.version as number) < 1) fail();
        return { kind, adapterId, version: node.version as number, payload: visit(node.payload, depth + 1, false) };
      }
      default: return fail();
    }
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > DEV_VALUE_LIMITS.bytes) fail("OVERSIZED_OBSERVATION");
  return result;
}

/** Adapter construction is confined to explicit replay/preflight decoding. */
export function decodeDevValue(value: unknown, options: DevCodecOptions = {}): unknown {
  return coded(() => decode(value, options));
}
function decode(value: unknown, options: DevCodecOptions): unknown {
  const root = validateDevValue(value), adapters = validateDevAdapters(options.adapters ?? []);
  const visit = (node: DevValue): unknown => {
    switch (node.kind) {
      case "undefined": return undefined;
      case "null": return null;
      case "number": case "boolean": case "string": return node.value;
      case "date": return new Date(node.value);
      case "bytes": {
        const bytes = unbase64(node.value);
        if (node.type === "ArrayBuffer") return bytes.buffer;
        if (node.type === "Uint8Array") return bytes;
        const Buffer = bufferType(); if (!Buffer) fail("RUNTIME_PROFILE_MISMATCH"); return Buffer.from(bytes);
      }
      case "array": return node.items.map(visit);
      case "record": return Object.fromEntries(node.entries.map(e => [e.key, visit(e.value)]));
      case "error": {
        const error = errorFactories[node.name]!(node.message);
        for (const field of node.fields) Object.defineProperty(error, field.key, { value: visit(field.value), writable: true, configurable: true, enumerable: field.key !== "cause" && field.key !== "errors" });
        return error;
      }
      case "adapted": {
        const adapter = adapters.find(a => a.id === node.adapterId && a.version === node.version);
        if (!adapter) fail("VALUE_ADAPTER_MISSING");
        let result: object;
        try { result = adapter.deserialize(visit(node.payload)); } catch { fail("VALUE_ADAPTER_DESERIALIZE_FAILED"); }
        if (!result || typeof result !== "object" || options.isProxy?.(result) || Object.getPrototypeOf(result) !== adapter.type.prototype) fail("VALUE_ADAPTER_PROTOTYPE_MISMATCH");
        if (JSON.stringify(encodeDevValue(result, options)) !== JSON.stringify(node)) fail("VALUE_ADAPTER_ROUND_TRIP_MISMATCH");
        return result;
      }
    }
  };
  return visit(root);
}

export function assertDevSafe(value: unknown): void { encodeDevValue(value); }
