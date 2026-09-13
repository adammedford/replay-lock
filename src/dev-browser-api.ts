/** Browser-only configuration helpers. Never import Node orchestration here. */
import type { DevAdapter, DevOptions } from "./dev-contract.js";
export const CASE_SCHEMA_VERSION = 1 as const;
export const REPLAYLOCK_VERSION = "0.1.0" as const;
export function defineValueAdapter<T extends object>(definition: {
  id: string; version: number; type: { prototype: T }; serialize(value: T): unknown; deserialize(payload: unknown): T;
}): typeof definition {
  return Object.freeze({ ...definition });
}
export function defineReplayLock(configuration: DevOptions & {
  valueAdapters?: readonly DevAdapter[]; trustedPackages?: readonly unknown[];
} = {}) {
  return Object.freeze({ ...configuration, valueAdapters: configuration.valueAdapters ?? [], trustedPackages: configuration.trustedPackages ?? [] });
}
