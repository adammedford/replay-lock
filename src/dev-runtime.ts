import type {
  DevCodecOptions, DevCompletion, DevEnvironment, DevMetadata, DevObservation,
  DevRuntimeConfiguration, DevRuntimeProfile, DevValue, TraceEvent,
} from "./dev-contract.js";
import { decodeDevValue, DEV_VALUE_LIMITS, devValueError, encodeDevValue, validateDevAdapters, validateDevValue } from "./dev-values.js";

declare const frameBrand: unique symbol;
/** A lexical capability: withDevContext lends it only for a synchronous handoff. */
export interface RuntimeFrame { readonly [frameBrand]: true }
interface ResponseHandle { id: number; used: boolean }
interface Capture {
  mode: "capture";
  frame: RuntimeFrame;
  parent: Capture | undefined;
  configuration: DevRuntimeConfiguration;
  metadata: DevMetadata;
  arguments: DevValue | undefined;
  trace: TraceEvent[];
  bytes: number;
  nextId: number;
  pending: number;
  children: number;
  closed: boolean;
  completed: boolean;
  blocked: boolean;
  responses: WeakMap<object, ResponseHandle>;
}
interface Replay {
  mode: "replay";
  frame: RuntimeFrame;
  trace: TraceEvent[];
  cursor: number;
  options: DevCodecOptions;
  mismatch: Error | undefined;
  closed: boolean;
  pending: Map<number, { operation: string; resolve(value: unknown): void; reject(error: unknown): void }>;
  responses: WeakMap<object, ResponseHandle>;
  values: Map<number, unknown>;
}
interface State {
  configuration: DevRuntimeConfiguration | undefined;
  accepting: boolean;
  current: RuntimeFrame | undefined;
  suspended: number;
  frames: WeakMap<RuntimeFrame, Capture | Replay>;
  pending: Set<Capture>;
  waiters: Set<() => void>;
}
const realmKey = Symbol.for("replaylock.dev.runtime.v2");
const realm = globalThis as typeof globalThis & { [realmKey]?: State };
const state: State = realm[realmKey] ??= {
  configuration: undefined, accepting: false, current: undefined, suspended: 0,
  frames: new WeakMap(), pending: new Set(), waiters: new Set(),
};
const asyncOperations = new Set(["fetch", "Response.json", "Response.text", "Response.arrayBuffer", "fs.readFile"]);
const operations = new Set([
  "Math.random", "crypto.randomUUID", "Date.now", "Date", "new Date", "performance.now",
  ...asyncOperations, "fs.readFileSync", "process.env", "import.meta.env",
]);
const MAX_EVENTS = 10_000;
const MAX_PENDING = 1_000;
const MAX_OBSERVATION_BYTES = DEV_VALUE_LIMITS.bytes;
const json = (value: unknown): string => JSON.stringify(value);

/** Sealed, codec-validated evidence; the verifier renders it without reading application objects. */
export interface DevTraceDifference {
  index: number;
  reason: "operation" | "arguments" | "missing" | "additional" | "unrenderable" | "sequence";
  expected?: TraceEvent;
  actual?: { operation: string; arguments?: DevValue };
}

function outsideCapture<T>(invoke: () => T): T {
  state.suspended++;
  try { return invoke(); } finally { state.suspended--; }
}
function codeOf(error: unknown): string {
  try {
    const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    return typeof code === "string" && /^(?:UNSUPPORTED_VALUE|UNSUPPORTED_EFFECT|SENSITIVE_VALUE|OVERSIZED_OBSERVATION|MUTATED_INPUT|VALUE_ADAPTER_[A-Z_]+)$/.test(code) ? code : "UNSUPPORTED_VALUE";
  } catch { return "UNSUPPORTED_VALUE"; }
}
function copyMetadata(metadata: DevMetadata): DevMetadata {
  return { ...metadata, locator: { ...metadata.locator, namePath: [...metadata.locator.namePath] } };
}
function activity(configuration: DevRuntimeConfiguration, kind: "invoked" | "completed", metadata: DevMetadata): void {
  try { outsideCapture(() => configuration.onActivity?.({ kind, metadata: copyMetadata(metadata) })); } catch { /* Observers cannot change application completion. */ }
}
function report(configuration: DevRuntimeConfiguration, code: string, metadata?: DevMetadata): void {
  try { outsideCapture(() => {
    const copy = metadata && copyMetadata(metadata);
    configuration.onBlock(copy ? { code, locator: copy.locator, metadata: copy } : { code });
  }); } catch { /* Observer failures cannot escape into application code. */ }
}
function block(frame: Capture, code: string): void {
  for (let current: Capture | undefined = frame; current; current = current.parent) {
    if (current.blocked) continue;
    current.blocked = true;
    current.arguments = undefined;
    current.trace = [];
    report(current.configuration, code, current.metadata);
  }
}
function guarded(frame: Capture, invoke: () => void): void {
  if (frame.blocked) return;
  try { outsideCapture(invoke); } catch (error) { block(frame, codeOf(error)); }
}
function nativePromise(value: unknown, options: DevCodecOptions): value is Promise<unknown> {
  // Promise.then consults a receiver's constructor/species; reject overrides first.
  return !!value && typeof value === "object" && !options.isProxy?.(value) && Object.getPrototypeOf(value) === Promise.prototype && Reflect.ownKeys(value).every(key => typeof key === "symbol");
}
function trackPromise(value: Promise<unknown>, onReturn: (value: unknown) => void, onThrow: (error: unknown) => void): void {
  // Do not replace the application's promise or read an arbitrary then getter.
  const observer = Promise.prototype.then.call(value, onReturn, onThrow) as Promise<unknown>;
  void Promise.prototype.then.call(observer, undefined, () => {});
}

export function configureDevRuntime(configuration: DevRuntimeConfiguration | undefined): void {
  if (configuration) {
    validateDevAdapters(configuration.adapters ?? []);
    if (typeof configuration.onObservation !== "function" || typeof configuration.onBlock !== "function" || (configuration.onActivity !== undefined && typeof configuration.onActivity !== "function")) throw devValueError("INVALID_CONFIGURATION");
  } else {
    for (const frame of [...state.pending]) { block(frame, "INCOMPLETE_OBSERVATION"); close(frame); }
  }
  state.configuration = configuration;
  state.accepting = configuration !== undefined;
}

export function withDevContext<T>(frame: RuntimeFrame | undefined, invoke: () => T): T {
  const previous = state.current;
  state.current = frame;
  try { return invoke(); } finally { state.current = previous; }
}

export function observeDevCall<T>(metadata: DevMetadata, args: readonly unknown[], invoke: (frame: RuntimeFrame | undefined) => T, asynchronous = false): T {
  const inherited = state.current && state.frames.get(state.current);
  if (inherited?.mode === "replay") {
    if (inherited.closed) throw latch(inherited);
    return withDevContext(inherited.frame, () => invoke(inherited.frame));
  }
  const configuration = state.configuration;
  if (!configuration || state.suspended) return invoke(undefined);
  const parent = inherited?.mode === "capture" && !inherited.closed ? inherited : undefined;
  if (!parent && !state.accepting) return withDevContext(undefined, () => invoke(undefined));
  activity(configuration, "invoked", metadata);
  const uncaptured = (): T => {
    let result: T;
    try { result = withDevContext(undefined, () => invoke(undefined)); }
    catch (error) { activity(configuration, "completed", metadata); throw error; }
    try {
      if (nativePromise(result, configuration)) trackPromise(result, () => activity(configuration, "completed", metadata), () => activity(configuration, "completed", metadata));
      else activity(configuration, "completed", metadata);
    } catch { /* Unsupported promises remain unobserved. */ }
    return result;
  };
  if (parent && (parent.metadata.generation !== metadata.generation || parent.metadata.environment !== metadata.environment)) {
    block(parent, "GENERATION_MISMATCH");
    return uncaptured();
  }
  if (state.pending.size >= MAX_PENDING) {
    if (parent) block(parent, "PENDING_LIMIT"); else report(configuration, "PENDING_LIMIT", metadata);
    return uncaptured();
  }
  const frame = {} as RuntimeFrame;
  const capture: Capture = {
    mode: "capture", frame, parent, configuration, metadata,
    arguments: undefined, trace: [], bytes: 0, nextId: 0, pending: 0, children: 0,
    blocked: false, closed: false, completed: false, responses: new WeakMap(),
  };
  state.frames.set(frame, capture);
  state.pending.add(capture);
  if (parent) parent.children++;
  guarded(capture, () => { capture.arguments = encodeDevValue(args, configuration); });
  let result: T;
  try { result = withDevContext(frame, () => invoke(frame)); }
  catch (error) { finish(capture, args, "throw", error); throw error; }
  let promise = false;
  try { promise = nativePromise(result, configuration); } catch { block(capture, "UNSUPPORTED_VALUE"); }
  if (promise) {
    if (!asynchronous) block(capture, "UNSUPPORTED_VALUE");
    try { trackPromise(result as Promise<unknown>, value => finish(capture, args, "return", value), error => finish(capture, args, "throw", error)); }
    catch { block(capture, "UNSUPPORTED_VALUE"); close(capture); }
  } else {
    if (asynchronous) block(capture, "UNSUPPORTED_VALUE");
    finish(capture, args, "return", result);
  }
  return result;
}

function close(frame: Capture): void {
  if (frame.closed) return;
  frame.closed = true;
  state.pending.delete(frame);
  if (frame.parent) frame.parent.children--;
  for (const notify of state.waiters) notify();
}
function finish(frame: Capture, args: readonly unknown[], kind: "return" | "throw", value: unknown): void {
  if (!frame.completed) {
    frame.completed = true;
    activity(frame.configuration, "completed", frame.metadata);
  }
  if (frame.closed) return;
  if (frame.pending || frame.children) block(frame, "INCOMPLETE_OBSERVATION");
  guarded(frame, () => {
    if (json(encodeDevValue(args, frame.configuration)) !== json(frame.arguments)) throw devValueError("MUTATED_INPUT");
    const completion: DevCompletion = { kind, value: encodeDevValue(value, frame.configuration) };
    const observation: DevObservation = { ...frame.metadata, arguments: frame.arguments!, trace: frame.trace, completion };
    if (new TextEncoder().encode(json(observation)).length > MAX_OBSERVATION_BYTES) throw devValueError("OVERSIZED_OBSERVATION");
    // Sinks own their copy: mutating a child's event must not corrupt an ancestor.
    try { frame.configuration.onObservation(JSON.parse(json(observation)) as DevObservation); } catch { block(frame, "STORAGE_FAILURE"); }
  });
  close(frame);
}
function ancestors(frame: Capture): Capture[] {
  const result: Capture[] = [];
  for (let current: Capture | undefined = frame; current; current = current.parent) {
    if (!current.closed && !current.blocked) result.push(current);
  }
  return result;
}
function append(frame: Capture, event: TraceEvent): void {
  const bytes = new TextEncoder().encode(json(event)).length;
  if (frame.trace.length >= MAX_EVENTS || frame.bytes + bytes > MAX_OBSERVATION_BYTES) throw devValueError("OVERSIZED_OBSERVATION");
  frame.bytes += bytes;
  frame.trace.push(event);
}

/** Native Response getters are used only for metadata, never to read or clone a body. */
function responseSnapshot(value: unknown, options: DevCodecOptions): Record<string, unknown> {
  if (!value || typeof value !== "object" || options.isProxy?.(value) || typeof Response === "undefined" || Object.getPrototypeOf(value) !== Response.prototype) throw devValueError("UNSUPPORTED_VALUE");
  // Browser/Node Response internal slots may be symbols. Own public overrides are unsupported.
  if (Reflect.ownKeys(value).some(key => typeof key === "string")) throw devValueError("UNSUPPORTED_VALUE");
  const get = (key: string): unknown => Object.getOwnPropertyDescriptor(Response.prototype, key)!.get!.call(value);
  const status = get("status");
  if (typeof status !== "number" || status < 200 || status > 599 || get("bodyUsed")) throw devValueError("UNSUPPORTED_VALUE");
  const headers = Array.from(Headers.prototype.entries.call(get("headers") as Headers));
  // Header names are privacy keys even though their wire representation is a tuple.
  encodeDevValue(Object.fromEntries(headers));
  return { status, statusText: get("statusText"), headers, url: get("url"), redirected: get("redirected"), type: get("type") };
}
function effectArguments(frame: Capture | Replay, operation: string, input: readonly unknown[]): DevValue {
  const options = frame.mode === "capture" ? frame.configuration : frame.options;
  if (options.isProxy?.(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw devValueError("UNSUPPORTED_VALUE");
  const length = Object.getOwnPropertyDescriptor(input, "length")!.value as number;
  if (length > DEV_VALUE_LIMITS.nodes || Reflect.ownKeys(input).length !== length + 1) throw devValueError("UNSUPPORTED_VALUE");
  const args = Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) throw devValueError("UNSUPPORTED_VALUE");
    return descriptor.value as unknown;
  });
  if (operation.startsWith("Response.")) {
    if (args.length !== 1 || !args[0] || typeof args[0] !== "object") throw devValueError("UNSUPPORTED_VALUE");
    const handle = frame.responses.get(args[0]);
    if (!handle) throw devValueError("UNSUPPORTED_VALUE");
    return encodeDevValue([{ responseId: handle.id }], options);
  }
  if (operation === "process.env" || operation === "import.meta.env") {
    if (args.length !== 1 || typeof args[0] !== "string") throw devValueError("UNSUPPORTED_VALUE");
    encodeDevValue({ [args[0]]: null }, options);
  }
  if (operation === "fetch") {
    // No coercion of URL/Request objects, custom headers, or request bodies.
    if (typeof args[0] !== "string" || args.length > 2) throw devValueError("UNSUPPORTED_VALUE");
    if (args[1] !== undefined) {
      const init = args[1];
      if (!init || typeof init !== "object" || options.isProxy?.(init) || Object.getPrototypeOf(init) !== Object.prototype) throw devValueError("UNSUPPORTED_VALUE");
      const descriptors = Object.getOwnPropertyDescriptors(init);
      if (descriptors.body || descriptors.signal) throw devValueError("UNSUPPORTED_EFFECT");
      const method = descriptors.method;
      if (method && (!("value" in method) || typeof method.value !== "string" || !["GET", "HEAD"].includes(method.value.toUpperCase()))) throw devValueError("UNSUPPORTED_EFFECT");
      const headers = descriptors.headers;
      if (headers && "value" in headers && Array.isArray(headers.value)) {
        // Encoding first proves tuples are data before iterating them.
        encodeDevValue(headers.value, options);
        encodeDevValue(Object.fromEntries(headers.value), options);
      }
    }
  }
  const encoded = encodeDevValue(args, options);
  if ((operation === "fs.readFile" || operation === "fs.readFileSync") && args[1] && typeof args[1] === "object") {
    const flag = Object.getOwnPropertyDescriptor(args[1], "flag");
    if (flag && flag.value !== undefined && flag.value !== "r" && flag.value !== "rs") throw devValueError("UNSUPPORTED_EFFECT");
  }
  return encoded;
}

export function devEffect<T>(frame: RuntimeFrame | undefined, operation: string, args: readonly unknown[], invoke: () => T): T {
  const context = frame && state.frames.get(frame);
  if (!context || state.suspended) return invoke();
  if (context.mode === "replay") return replayEffect(context, operation, args) as T;
  if (context.closed || context.blocked) return invoke();
  if (!operations.has(operation)) { block(context, "UNSUPPORTED_EFFECT"); return invoke(); }
  const projections = ancestors(context).map(frame => ({ frame, id: frame.nextId++ }));
  for (const { frame, id } of projections) guarded(frame, () => {
    append(frame, { kind: "call", id, operation, arguments: effectArguments(frame, operation, args) });
    frame.pending++;
  });
  const settle = (kind: "return" | "throw", value: unknown): void => {
    let encoded: DevValue | undefined, snapshot: Record<string, unknown> | undefined;
    // Serialize an effect value once; project the same sealed value into ancestors.
    if (!context.blocked) guarded(context, () => {
      if (kind === "return" && operation === "fetch") snapshot = responseSnapshot(value, context.configuration);
      else encoded = encodeDevValue(value, context.configuration);
    });
    for (const { frame, id } of projections) {
      if (frame.pending > 0) frame.pending--;
      if (frame.closed) continue;
      guarded(frame, () => {
        let result = encoded!;
        if (snapshot) {
          frame.responses.set(value as object, { id, used: false });
          result = encodeDevValue({ responseId: id, ...snapshot }, frame.configuration);
        }
        if (operation.startsWith("Response.") && args[0] && typeof args[0] === "object") {
          const handle = frame.responses.get(args[0]); if (handle) handle.used = true;
        }
        append(frame, { kind, id, value: result });
      });
    }
  };
  let result: T;
  try { result = invoke(); } catch (error) { settle("throw", error); throw error; }
  let promise = false;
  try { promise = nativePromise(result, context.configuration); } catch { block(context, "UNSUPPORTED_VALUE"); }
  if (promise) {
    if (!asyncOperations.has(operation)) block(context, "UNSUPPORTED_EFFECT");
    try { trackPromise(result as Promise<unknown>, value => settle("return", value), error => settle("throw", error)); }
    catch { block(context, "UNSUPPORTED_VALUE"); }
  } else {
    if (asyncOperations.has(operation)) block(context, "UNSUPPORTED_EFFECT");
    settle("return", result);
  }
  return result;
}

function latch(frame: Replay, difference?: DevTraceDifference): Error {
  frame.mismatch ??= Object.assign(devValueError("TRACE_MISMATCH"), { difference: difference ?? {
    index: frame.cursor, reason: "sequence", ...(frame.trace[frame.cursor] ? { expected: frame.trace[frame.cursor] } : {}),
  } });
  for (const pending of frame.pending.values()) pending.reject(frame.mismatch);
  frame.pending.clear();
  return frame.mismatch;
}
function replayResponse(frame: Replay, id: number, input: unknown): Response {
  if (!input || typeof input !== "object") throw latch(frame);
  const value = input as Record<string, unknown>;
  if (value.responseId !== id || typeof value.status !== "number" || typeof value.statusText !== "string" || !Array.isArray(value.headers) ||
      typeof value.url !== "string" || typeof value.redirected !== "boolean" || typeof value.type !== "string") throw latch(frame);
  const response = new Response(null, { status: value.status, statusText: value.statusText, headers: value.headers as [string, string][] });
  const handle = { id, used: false };
  frame.responses.set(response, handle);
  for (const key of ["url", "redirected", "type"]) Object.defineProperty(response, key, { value: value[key], configurable: true });
  Object.defineProperty(response, "bodyUsed", { get: () => handle.used, configurable: true });
  return response;
}
function settlementValue(frame: Replay, event: TraceEvent & { kind: "return" | "throw" }, operation: string): unknown {
  const decoded = frame.values.get(event.id);
  return operation === "fetch" && event.kind === "return" ? replayResponse(frame, event.id, decoded) : decoded;
}
function pump(frame: Replay): void {
  if (frame.mismatch || frame.closed) return;
  while (frame.cursor < frame.trace.length) {
    const event = frame.trace[frame.cursor]!;
    if (event.kind === "call") return;
    const pending = frame.pending.get(event.id);
    if (!pending) return;
    frame.cursor++;
    frame.pending.delete(event.id);
    try {
      const value = settlementValue(frame, event, pending.operation);
      if (event.kind === "throw") pending.reject(value); else pending.resolve(value);
    } catch { pending.reject(latch(frame)); }
  }
}
function replayEffect(frame: Replay, operation: string, args: readonly unknown[]): unknown {
  if (frame.mismatch || frame.closed || !operations.has(operation)) throw latch(frame);
  let encoded: DevValue;
  pump(frame);
  const call = frame.trace[frame.cursor];
  try { encoded = effectArguments(frame, operation, args); }
  catch { throw latch(frame, { index: frame.cursor, reason: "unrenderable", ...(call ? { expected: call } : {}), actual: { operation } }); }
  if (!call || call.kind !== "call" || call.operation !== operation || json(call.arguments) !== json(encoded)) throw latch(frame, {
    index: frame.cursor, reason: !call ? "additional" : call.kind !== "call" ? "sequence" : call.operation !== operation ? "operation" : "arguments",
    ...(call ? { expected: call } : {}), actual: { operation, arguments: encoded },
  });
  frame.cursor++;
  if (operation.startsWith("Response.")) frame.responses.get(args[0] as object)!.used = true;
  if (asyncOperations.has(operation)) {
    const promise = new Promise((resolve, reject) => { frame.pending.set(call.id, { operation, resolve, reject }); });
    // A replay mismatch may reject an unawaited effect; suppress engine-owned noise.
    void promise.catch(() => {});
    queueMicrotask(() => pump(frame));
    return promise;
  }
  const event = frame.trace[frame.cursor];
  if (!event || event.kind === "call" || event.id !== call.id) throw latch(frame);
  frame.cursor++;
  const value = settlementValue(frame, event, operation);
  if (event.kind === "throw") throw value;
  return value;
}

function validateTrace(trace: readonly TraceEvent[], options: DevCodecOptions): TraceEvent[] {
  const invalid = (): never => { throw devValueError("TRACE_MISMATCH"); };
  const own = (value: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : invalid();
  };
  if (options.isProxy?.(trace) || !Array.isArray(trace) || Object.getPrototypeOf(trace) !== Array.prototype) return invalid();
  const length = own(trace, "length") as number;
  if (length > MAX_EVENTS || Reflect.ownKeys(trace).length !== length + 1) return invalid();
  const pending = new Set<number>();
  let previousId = -1, bytes = 0;
  const result: TraceEvent[] = [];
  for (let index = 0; index < length; index++) {
    const event = own(trace, String(index));
    if (!event || typeof event !== "object" || options.isProxy?.(event) || Object.getPrototypeOf(event) !== Object.prototype) return invalid();
    const id = own(event, "id"), kind = own(event, "kind"), keys = Reflect.ownKeys(event);
    if (!Number.isSafeInteger(id) || (id as number) < 0 || keys.some(key => typeof key !== "string")) return invalid();
    let parsed: TraceEvent;
    if (kind === "call") {
      const operation = own(event, "operation");
      if ((id as number) <= previousId || typeof operation !== "string" || !operations.has(operation) || keys.sort().join() !== "arguments,id,kind,operation") return invalid();
      const args = validateDevValue(own(event, "arguments"));
      if (args.kind !== "array") return invalid();
      pending.add(id as number);
      previousId = id as number;
      parsed = { kind, id: id as number, operation, arguments: args };
    } else {
      if ((kind !== "return" && kind !== "throw") || !pending.delete(id as number) || keys.sort().join() !== "id,kind,value") return invalid();
      parsed = { kind, id: id as number, value: validateDevValue(own(event, "value")) };
    }
    bytes += new TextEncoder().encode(json(parsed)).length;
    if (bytes > MAX_OBSERVATION_BYTES) return invalid();
    result.push(parsed);
  }
  if (pending.size) return invalid();
  return result;
}

/** The caller supplies an isolated module/realm; this never calls a native effect. */
export async function replayDevTrace(trace: readonly TraceEvent[], invoke: (frame: RuntimeFrame) => unknown, codecOptions: DevCodecOptions = {}): Promise<unknown> {
  const frame = {} as RuntimeFrame;
  const replay: Replay = {
    mode: "replay", frame, trace: validateTrace(trace, codecOptions), cursor: 0, options: codecOptions,
    mismatch: undefined, closed: false, pending: new Map(), responses: new WeakMap(), values: new Map(),
  };
  // Preflight every adapted value before running application code, including throws.
  for (const event of replay.trace) {
    if (event.kind === "call") decodeDevValue(event.arguments, codecOptions);
    else replay.values.set(event.id, decodeDevValue(event.value, codecOptions));
  }
  state.frames.set(frame, replay);
  let result: unknown, thrown: unknown, didThrow = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(latch(replay)), 5000); });
  try { result = await Promise.race([withDevContext(frame, () => invoke(frame)), stalled]); }
  catch (error) { thrown = error; didThrow = true; }
  finally { clearTimeout(timer); }
  if (replay.cursor !== replay.trace.length || replay.pending.size) latch(replay, {
    index: replay.cursor, reason: "missing", ...(replay.trace[replay.cursor] ? { expected: replay.trace[replay.cursor] } : {}),
  });
  replay.closed = true;
  if (replay.mismatch) throw replay.mismatch;
  if (didThrow) throw thrown;
  return result;
}

/** Stop new roots and drain existing invocations. Timeouts report valueless blocks. */
export async function flushDevRuntime(timeoutMs = 5000): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw devValueError("INVALID_CONFIGURATION");
  state.accepting = false;
  if (!state.pending.size) return;
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const done = (): void => {
      if (state.pending.size) return;
      clearTimeout(timer); state.waiters.delete(done); resolve();
    };
    timer = setTimeout(() => {
      state.waiters.delete(done);
      for (const frame of [...state.pending]) { block(frame, "INCOMPLETE_OBSERVATION"); close(frame); }
      resolve();
    }, timeoutMs);
    state.waiters.add(done);
    done();
  });
}

export function runtimeProfile(environment: DevEnvironment): DevRuntimeProfile {
  const intl = Intl.DateTimeFormat().resolvedOptions();
  const host = globalThis as typeof globalThis & { process?: { versions?: { node?: string } } };
  return {
    environment,
    runtime: environment === "node" ? `node:${host.process?.versions?.node ?? "unknown"}` : `browser:${globalThis.navigator?.userAgent ?? "unknown"}`,
    timezone: intl.timeZone, locale: intl.locale,
  };
}
