/** Portable contracts for development capture. This module has no Node imports. */
export const DEV_SCHEMA_VERSION = 2 as const;
export type DevEnvironment = "node" | "browser";
export interface DevLocator {
  module: string;
  kind: "export" | "local" | "nested";
  namePath: string[];
}
export interface DevOptions {
  capture?: { mode?: "automatic" | "annotated"; include?: string[]; exclude?: string[]; retention?: false | Partial<DevRetentionPolicy> };
  effects?: { randomness?: boolean; time?: boolean; fetch?: boolean; filesystem?: boolean; environment?: string[] };
}
export interface DevRetentionPolicy { maxPerCallable: number; maxPerGroup: number }
export interface ResolvedDevOptions {
  /** Resolved Vite string aliases, supplied by the host rather than user capture policy. */
  resolveAliases?: { find: string; replacement: string }[];
  capture: { mode: "automatic" | "annotated"; include: string[]; exclude: string[]; retention?: false | DevRetentionPolicy };
  effects: { randomness: boolean; time: boolean; fetch: boolean; filesystem: boolean; environment: string[] };
}
export type DevValue =
  | { kind: "undefined" | "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "array"; items: DevValue[] }
  | { kind: "record"; entries: { key: string; value: DevValue }[] }
  | { kind: "date"; value: string }
  | { kind: "bytes"; type: "ArrayBuffer" | "Uint8Array" | "Buffer"; value: string }
  | { kind: "error"; name: string; message: string; fields: { key: string; value: DevValue }[] }
  | { kind: "adapted"; adapterId: string; version: number; payload: DevValue };
export interface DevCompletion { kind: "return" | "throw"; value: DevValue }
export type TraceEvent =
  | { kind: "call"; id: number; operation: string; arguments: DevValue }
  | { kind: "return" | "throw"; id: number; value: DevValue };
export interface DevMetadata {
  locator: DevLocator;
  sourceGraphDigest: string;
  generation: string;
  environment: DevEnvironment;
}
export interface DevObservation extends DevMetadata {
  arguments: DevValue;
  trace: TraceEvent[];
  completion: DevCompletion;
}
export interface DevBlock {
  code: string;
  locator?: DevLocator;
  metadata?: DevMetadata;
}
export interface DevActivity { kind: "invoked" | "completed"; metadata: DevMetadata }
export interface DevRuntimeProfile {
  environment: DevEnvironment;
  runtime: string;
  timezone: string;
  locale: string;
}
export interface DevCase {
  schemaVersion: 2;
  caseId: string;
  locator: DevLocator;
  environment: DevEnvironment;
  arguments: DevValue;
  trace: TraceEvent[];
  completion: DevCompletion;
  comparison: "exact" | { kind: "tolerance"; epsilon: number };
  eligibility: { verdict: "replayable"; reasonCodes: string[] };
  provenance: {
    sourceGraphDigest: string;
    lockfileDigest: string;
    runtimeProfile: DevRuntimeProfile;
    captureStatus: "complete" | "partial";
  };
}
export interface DevCandidate extends DevCase { occurrences: number; replacesCaseId?: string }
export interface DevAdapter {
  id: string;
  version: number;
  type: { prototype: object };
  serialize(value: object): unknown;
  deserialize(payload: unknown): object;
}
export interface DevCodecOptions {
  adapters?: readonly DevAdapter[];
  isProxy?: (value: unknown) => boolean;
}
export interface DevRuntimeConfiguration extends DevCodecOptions {
  onObservation(observation: DevObservation): void;
  onBlock(block: DevBlock): void;
  onActivity?(activity: DevActivity): void;
}
export interface DevSourcePosition { module: string; line: number; column: number }
export interface DevDiagnostic { code: string; locator?: DevLocator; message: string; position?: DevSourcePosition; causes?: { code: string; position: DevSourcePosition }[] }
export interface DevTarget { locator: DevLocator; replayExport: string }
export interface DevAnalysis {
  targets: DevTarget[];
  diagnostics: DevDiagnostic[];
  sourceGraphDigest: string;
}
export interface DevTransformOptions {
  root: string;
  id: string;
  code: string;
  environment: DevEnvironment;
  generation: string;
  options: ResolvedDevOptions;
  replay?: boolean;
  runtimeImport?: string;
}
export interface DevTransformResult extends DevAnalysis { code: string; map: unknown }
