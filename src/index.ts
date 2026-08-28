export { CASE_SCHEMA_VERSION, REPLAYLOCK_VERSION } from "./model.js";
export {
  defineReplayLock,
  defineValueAdapter,
  TrustedPackageConfigurationError,
  type ReplayLockConfiguration,
  type ReplayValue,
  type StructuralClassToken,
  type TrustedPackage,
  type TrustedPackageDiagnosticCode,
  type TrustedPackageExport,
  type ValueAdapter,
  type ValueAdapterDefinition,
} from "./adapters.js";
export { replaylock } from "./vite-plugin.js";
