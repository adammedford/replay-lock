import { types as utilTypes } from "node:util";
import {
  TrustedPackageConfigurationError,
  type ReplayLockConfiguration,
} from "./adapters.js";
import { isObject } from "./model.js";
import type { ProjectLockfile } from "./project-lockfile.js";

export interface PackageCatalogEntry {
  readonly package: string;
  readonly export: string;
  readonly versions?: string;
  readonly unpinned: boolean;
}

export interface PackageCatalog {
  readonly entries: readonly PackageCatalogEntry[];
}

export const emptyPackageCatalog: PackageCatalog = Object.freeze({ entries: Object.freeze([]) });

export type PackageCallTrust =
  | { trusted: true; matchedVersion?: string; unpinned: boolean }
  | { trusted: false };

const versionPattern = /^\d+\.\d+\.\d+$/;

/** Structural + duplicate + semver-range validation. Mirrors the defensive posture used for valueAdapters. */
export function validateTrustedPackages(
  configuration: ReplayLockConfiguration | undefined,
): PackageCatalog {
  const configured = readConfiguredTrustedPackages(configuration);
  const entries: PackageCatalogEntry[] = [];
  const seen = new Set<string>();
  for (let packageIndex = 0; packageIndex < configured.length; packageIndex += 1) {
    const trustedPackage = normalizeTrustedPackage(configured[packageIndex], packageIndex);
    for (let exportIndex = 0; exportIndex < trustedPackage.exports.length; exportIndex += 1) {
      const entry = normalizeTrustedPackageExport(
        trustedPackage.package,
        trustedPackage.exports[exportIndex],
        packageIndex,
        exportIndex,
      );
      const identity = `${entry.package}\0${entry.export}`;
      if (seen.has(identity)) {
        throw new TrustedPackageConfigurationError(
          "TRUSTED_PACKAGE_ID_DUPLICATE",
          `trusted package export ${JSON.stringify(entry.package)}#${JSON.stringify(entry.export)} is declared more than once`,
        );
      }
      seen.add(identity);
      entries.push(entry);
    }
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

/** npm-only for this iteration: parses package-lock.json's packages[...] shape, falling back to the legacy dependencies shape. */
export function resolveTrustedPackageVersion(
  lockfile: ProjectLockfile,
  packageName: string,
): string | undefined {
  if (lockfile.name !== "package-lock.json") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(lockfile.bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;
  if (isObject(parsed.packages)) {
    const entry = parsed.packages[`node_modules/${packageName}`];
    if (isObject(entry) && typeof entry.version === "string") return entry.version;
  }
  if (isObject(parsed.dependencies)) {
    const entry = parsed.dependencies[packageName];
    if (isObject(entry) && typeof entry.version === "string") return entry.version;
  }
  return undefined;
}

/** The single entry point call-graph resolution consults for a package import that would otherwise be unknown evidence. */
export function isPackageCallTrusted(
  catalog: PackageCatalog | undefined,
  packageName: string,
  exportName: string,
  lockfile: ProjectLockfile | undefined,
): PackageCallTrust {
  if (!catalog) return { trusted: false };
  const entry = catalog.entries.find(
    (candidate) => candidate.package === packageName && candidate.export === exportName,
  );
  if (!entry) return { trusted: false };
  if (entry.unpinned) return { trusted: true, unpinned: true };
  if (!lockfile || !entry.versions) return { trusted: false };
  const installedVersion = resolveTrustedPackageVersion(lockfile, packageName);
  if (!installedVersion || !versionSatisfiesRange(installedVersion, entry.versions)) {
    return { trusted: false };
  }
  return { trusted: true, matchedVersion: installedVersion, unpinned: false };
}

function isValidVersionRangeSyntax(range: string): boolean {
  if (range === "*") return true;
  const prefix = range[0] === "^" || range[0] === "~" ? range[0] : "";
  return versionPattern.test(prefix ? range.slice(1) : range);
}

function versionSatisfiesRange(version: string, range: string): boolean {
  if (range === "*") return true;
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return false;
  const prefix = range[0] === "^" || range[0] === "~" ? range[0] : "";
  const rangeVersion = parseVersion(prefix ? range.slice(1) : range);
  if (!rangeVersion) return false;
  if (!prefix) return compareVersions(parsedVersion, rangeVersion) === 0;
  if (compareVersions(parsedVersion, rangeVersion) < 0) return false;
  if (prefix === "~") {
    return parsedVersion[0] === rangeVersion[0] && parsedVersion[1] === rangeVersion[1];
  }
  if (rangeVersion[0] > 0) return parsedVersion[0] === rangeVersion[0];
  if (rangeVersion[1] > 0) return parsedVersion[0] === 0 && parsedVersion[1] === rangeVersion[1];
  return parsedVersion[0] === 0 && parsedVersion[1] === 0 && parsedVersion[2] === rangeVersion[2];
}

function parseVersion(text: string): [number, number, number] | undefined {
  if (!versionPattern.test(text)) return undefined;
  const [major, minor, patch] = text.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function readConfiguredTrustedPackages(
  configuration: ReplayLockConfiguration | undefined,
): unknown[] {
  if (configuration === undefined) return [];
  if (
    (typeof configuration !== "object" && typeof configuration !== "function") ||
    configuration === null ||
    utilTypes.isProxy(configuration)
  ) {
    throw new TrustedPackageConfigurationError(
      "TRUSTED_PACKAGE_DEFINITION_INVALID",
      "configuration must be an ordinary object",
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(configuration, "trustedPackages");
  if (descriptor === undefined) return [];
  return copyOrdinaryArray(dataDescriptorValue(descriptor, "configuration.trustedPackages"), "trustedPackages");
}

function normalizeTrustedPackage(value: unknown, index: number): { package: string; exports: unknown[] } {
  const subject = `trustedPackages[${index}]`;
  if ((typeof value !== "object" && typeof value !== "function") || value === null || utilTypes.isProxy(value)) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be a non-Proxy object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol" || !["package", "exports"].includes(key))) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} has unsupported properties`);
  }
  const packageName = dataDescriptorValue(descriptors.package, `${subject}.package`);
  if (typeof packageName !== "string" || packageName.trim().length === 0) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject}.package must be a nonempty string`);
  }
  const exportsArray = copyOrdinaryArray(dataDescriptorValue(descriptors.exports, `${subject}.exports`), `${subject}.exports`);
  return { package: packageName, exports: exportsArray };
}

function normalizeTrustedPackageExport(
  packageName: string,
  value: unknown,
  packageIndex: number,
  exportIndex: number,
): PackageCatalogEntry {
  const subject = `trustedPackages[${packageIndex}].exports[${exportIndex}]`;
  if ((typeof value !== "object" && typeof value !== "function") || value === null || utilTypes.isProxy(value)) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be a non-Proxy object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol" || !["export", "versions", "unpinned"].includes(key))) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} has unsupported properties`);
  }
  if (descriptors.export === undefined) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject}.export is required`);
  }
  const exportName = dataDescriptorValue(descriptors.export, `${subject}.export`);
  if (typeof exportName !== "string" || exportName.trim().length === 0) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject}.export must be a nonempty string`);
  }
  const unpinnedValue = descriptors.unpinned === undefined ? false : dataDescriptorValue(descriptors.unpinned, `${subject}.unpinned`);
  if (typeof unpinnedValue !== "boolean") {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject}.unpinned must be a boolean`);
  }
  const versionsValue = descriptors.versions === undefined ? undefined : dataDescriptorValue(descriptors.versions, `${subject}.versions`);
  if (versionsValue !== undefined && typeof versionsValue !== "string") {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject}.versions must be a string`);
  }
  const unpinned = unpinnedValue || versionsValue === "*";
  if (!unpinned && (versionsValue === undefined || !isValidVersionRangeSyntax(versionsValue))) {
    throw new TrustedPackageConfigurationError(
      "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
      `${subject}.versions must be a valid exact, caret, or tilde semver range when not unpinned`,
    );
  }
  if (unpinned && versionsValue !== undefined && versionsValue !== "*" && !isValidVersionRangeSyntax(versionsValue)) {
    throw new TrustedPackageConfigurationError(
      "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
      `${subject}.versions must be a valid exact, caret, or tilde semver range`,
    );
  }
  return Object.freeze({
    package: packageName,
    export: exportName,
    ...(unpinned ? {} : { versions: versionsValue as string }),
    unpinned,
  });
}

function copyOrdinaryArray(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be an ordinary dense array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = dataDescriptorValue(descriptors["length"], `${subject}.length`);
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} has an invalid length`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== (length as number) + 1) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be dense and contain no extra properties`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    result.push(dataDescriptorValue(descriptors[String(index)], `${subject}[${index}]`));
  }
  return result;
}

function dataDescriptorValue(descriptor: PropertyDescriptor | undefined, subject: string): unknown {
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TrustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be an own data property`);
  }
  return descriptor.value;
}
