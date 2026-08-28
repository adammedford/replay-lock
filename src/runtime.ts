import { createRequire } from "node:module";
import { types as utilTypes } from "node:util";
import type { ValueAdapterRegistry } from "./adapters.js";
import type { CandidateBlock, CandidateSessionRecord } from "./candidates.js";
import {
  isReplayNumber,
  REPLAYLOCK_VERSION,
  type CaptureMetadata,
  type Observation,
  type RuntimeProfile,
} from "./model.js";
import { classifyObservation, snapshotEntryArguments } from "./observation-safety.js";
import { registerSessionWorker, reportSessionStorageFailure } from "./session.js";

type RuntimeBlockedRecord = Extract<CandidateSessionRecord, { state: "blocked" }> & {
  /** Safe compatibility projection for session-inspection tooling. */
  locator: CaptureMetadata["locator"];
};
type LegacyNumericObservation = Omit<Observation, "arguments" | "completion"> & {
  arguments: number[];
  completion: { kind: "return"; value: number };
};
type RuntimeSessionRecord = Observation | LegacyNumericObservation | RuntimeBlockedRecord;

const require = createRequire(import.meta.url);
const vitePackage = require("vite/package.json") as { version: string };
const vitestPackage = require("vitest/package.json") as { version: string };

export function observeCall<T>(
  metadata: CaptureMetadata,
  arguments_: readonly unknown[],
  invoke: () => T,
  valueAdapters?: ValueAdapterRegistry,
  asynchronous = false,
): T {
  if (asynchronous) {
    return observeAsyncCall(metadata, arguments_, invoke as () => Promise<unknown>, valueAdapters) as T;
  }

  const sessionDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const token = process.env.REPLAYLOCK_SESSION_TOKEN;
  if (!sessionDirectory || !token) return invoke();

  // Snapshot before invocation without substituting values into the call and
  // without creating a content-derived hash, name, log, or durable record.
  const adapterOptions = valueAdapters ? { valueAdapters } : {};
  const entry = snapshotEntryArguments(metadata.locator, arguments_, adapterOptions);

  let completion: { kind: "return" | "throw"; value: unknown };
  let result: T | undefined;
  let thrown: unknown;
  try {
    result = invoke();
    completion = { kind: "return", value: result };
  } catch (error) {
    thrown = error;
    completion = { kind: "throw", value: error };
  }

  try {
    const record = createSessionRecord(metadata, token, arguments_, entry, completion, valueAdapters);
    if (record) writeCompletedObservation(sessionDirectory, token, record);
  } catch {
    reportSessionStorageFailure(sessionDirectory, token);
  }

  if (completion.kind === "throw") throw thrown;
  return result as T;
}

/**
 * The async counterpart of the synchronous path above: the captured callable
 * is declared `async`, so `invoke` is awaited before a completion exists at
 * all. This is a distinct path from the synchronous one's Promise/thenable
 * guard in `createSessionRecord`, which exists for a *sync*-declared callable
 * that unexpectedly returns a promise and must keep skipping that case.
 */
async function observeAsyncCall(
  metadata: CaptureMetadata,
  arguments_: readonly unknown[],
  invoke: () => Promise<unknown>,
  valueAdapters?: ValueAdapterRegistry,
): Promise<unknown> {
  const sessionDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const token = process.env.REPLAYLOCK_SESSION_TOKEN;
  if (!sessionDirectory || !token) return invoke();

  const adapterOptions = valueAdapters ? { valueAdapters } : {};
  const entry = snapshotEntryArguments(metadata.locator, arguments_, adapterOptions);

  let completion: { kind: "return" | "throw"; value: unknown };
  let result: unknown;
  let thrown: unknown;
  try {
    result = await invoke();
    completion = { kind: "return", value: result };
  } catch (error) {
    thrown = error;
    completion = { kind: "throw", value: error };
  }

  try {
    const record = createSessionRecord(metadata, token, arguments_, entry, completion, valueAdapters);
    if (record) writeCompletedObservation(sessionDirectory, token, record);
  } catch {
    reportSessionStorageFailure(sessionDirectory, token);
  }

  if (completion.kind === "throw") throw thrown;
  return result;
}

function createSessionRecord(
  metadata: CaptureMetadata,
  token: string,
  exitArguments: readonly unknown[],
  entry: ReturnType<typeof snapshotEntryArguments>,
  completion: { kind: "return" | "throw"; value: unknown },
  valueAdapters?: ValueAdapterRegistry,
): RuntimeSessionRecord | undefined {
  if (!entry.safe) return blockedRecord(entry.code, metadata, entry.diagnostic.safePath);
  const adapterOptions = valueAdapters ? { valueAdapters } : {};

  if (completion.kind === "return") {
    // Node's proxy predicate does not invoke traps. A returned Proxy is an
    // explicitly unsupported completion, represented only by a valueless
    // block so none of its properties can escape into durable state.
    if (utilTypes.isProxy(completion.value)) {
      return blockedRecord("UNSUPPORTED_VALUE", metadata, "$completion");
    }

    // Promise/thenable completions must reach the caller without assimilation
    // and must never become observations. Looking up `value.then` would itself
    // invoke accessors, so inspect descriptors along the prototype chain. An
    // accessor is conservatively treated as potentially callable.
    if (utilTypes.isPromise(completion.value) || hasThenableShape(completion.value)) {
      return undefined;
    }
  }

  const classified = classifyObservation({
    locator: metadata.locator,
    entryCanonicalArguments: entry.arguments,
    exitArguments,
    completion,
  }, adapterOptions);
  if (!classified.safe) {
    return blockedRecord(classified.code, metadata, classified.diagnostic.safePath);
  }

  const base = {
    token,
    locator: metadata.locator,
    sourceGraphDigest: metadata.sourceGraphDigest,
    runtimeProfile: runtimeProfile(),
    ...(metadata.assumption ? { assumption: metadata.assumption } : {}),
    ...(metadata.packageTrust && metadata.packageTrust.length > 0 ? { packageTrust: metadata.packageTrust } : {}),
  };
  if (
    completion.kind === "return" &&
    isReplayNumber(completion.value) &&
    exitArguments.every(isReplayNumber) &&
    classified.observation.entryArguments.kind === "array" &&
    classified.observation.entryArguments.items.every((item) => item.kind === "number")
  ) {
    return {
      ...base,
      arguments: [...exitArguments],
      completion: { kind: "return", value: completion.value },
    };
  }
  return {
    ...base,
    arguments: classified.observation.entryArguments as Observation["arguments"],
    completion: classified.observation.completion,
  };
}

function hasThenableShape(value: unknown): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }

  let current: object | null = value;
  try {
    while (current !== null) {
      // A proxy in the prototype chain cannot be inspected safely. Skipping
      // the completion is conservative and avoids every user-defined trap.
      if (utilTypes.isProxy(current)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(current, "then");
      if (descriptor) {
        return "value" in descriptor ? typeof descriptor.value === "function" : true;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    // Unknown exotic objects are not worth probing further during recording.
    return true;
  }
  return false;
}

function blockedRecord(
  code: CandidateBlock["code"],
  metadata: CaptureMetadata,
  safePath: string,
): RuntimeBlockedRecord {
  return {
    state: "blocked",
    locator: { ...metadata.locator },
    block: {
      code,
      locator: { ...metadata.locator },
      safePath,
    },
  };
}

function writeCompletedObservation(
  directory: string,
  token: string,
  observation: RuntimeSessionRecord,
): void {
  // A Vitest worker may be terminated without Node process lifecycle hooks.
  // Seal each naturally completed call as its own worker transaction so a
  // later forced termination cannot turn already-complete data into a partial
  // writer.
  const writer = registerSessionWorker<RuntimeSessionRecord>(directory, token);
  writer.writeCompleted(observation);
  writer.close();
}

function runtimeProfile(): RuntimeProfile {
  const internationalization = new Intl.DateTimeFormat().resolvedOptions();
  return {
    node: process.version,
    vite: vitePackage.version,
    vitest: vitestPackage.version,
    replaylock: REPLAYLOCK_VERSION,
    platform: process.platform,
    architecture: process.arch,
    timezone: internationalization.timeZone ?? "unknown",
    locale: internationalization.locale,
  };
}
