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

/**
 * Version lookup is implemented for `package-lock.json` (npm), `bun.lock`
 * (Bun's text lockfile), and `pnpm-lock.yaml`. `yarn.lock` and `bun.lockb`
 * remain unparsed; a catalog entry for a project on one of those must use
 * `unpinned: true` until a follow-up adds real version extraction.
 */
export function resolveTrustedPackageVersion(
  lockfile: ProjectLockfile,
  packageName: string,
): string | undefined {
  if (lockfile.name === "package-lock.json") return resolveNpmVersion(lockfile, packageName);
  if (lockfile.name === "bun.lock") return resolveBunTextVersion(lockfile, packageName);
  if (lockfile.name === "pnpm-lock.yaml") return resolvePnpmVersion(lockfile, packageName);
  if (lockfile.name === "yarn.lock") return resolveYarnClassicVersion(lockfile, packageName);
  return undefined;
}

function resolveNpmVersion(lockfile: ProjectLockfile, packageName: string): string | undefined {
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

/**
 * Bun's text lockfile keys `packages` by exact package name; each value is an
 * array whose first element is always a `"<name>@<resolution>"` string,
 * regardless of how many further elements a dependency type adds. A scoped
 * name's own leading `@` is never the separator: only the *last* `@` in the
 * string marks the resolution boundary, so this splits there rather than at
 * the first occurrence. A non-semver resolution (a git ref, a workspace
 * link) is returned as-is; the caller's range check already rejects it.
 */
function resolveBunTextVersion(lockfile: ProjectLockfile, packageName: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = parseJsonWithComments(Buffer.from(lockfile.bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || !isObject(parsed.packages)) return undefined;
  const entry = parsed.packages[packageName];
  if (!Array.isArray(entry) || entry.length === 0) return undefined;
  const resolved = entry[0];
  if (typeof resolved !== "string") return undefined;
  const separator = resolved.lastIndexOf("@");
  if (separator <= 0) return undefined;
  const version = resolved.slice(separator + 1);
  return version.length > 0 ? version : undefined;
}

/**
 * pnpm-lock.yaml is genuine YAML, and this project takes on no YAML-parsing
 * dependency; a hand-rolled indentation-based block scanner is used instead,
 * tailored to the narrow, highly regular subset pnpm itself emits (block
 * mappings, 2-space indentation, no anchors/aliases/flow collections in the
 * `importers` section). The version actually resolved for a project's own
 * declared dependency lives under `importers.'.'.<dependency-kind>.<name>`,
 * not the flat `packages` map — that map keys every transitively resolved
 * version of every package, with no notion of "the one this project uses."
 * A peer-dependency-qualified version (`1.6.4(@types/node@22.0.0)`) is
 * truncated to its base semver before the caller's range check runs.
 */
function resolvePnpmVersion(lockfile: ProjectLockfile, packageName: string): string | undefined {
  const lines = Buffer.from(lockfile.bytes).toString("utf8").split("\n");
  const importers = findYamlBlock(lines, 0, lines.length, 0, "importers");
  if (!importers) return undefined;
  const root = findYamlBlock(lines, importers.start, importers.end, importers.childIndent, ".");
  if (!root) return undefined;
  for (const dependencyKind of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const block = findYamlBlock(lines, root.start, root.end, root.childIndent, dependencyKind);
    if (!block) continue;
    const entry = findYamlBlock(lines, block.start, block.end, block.childIndent, packageName);
    if (!entry) continue;
    const version = findYamlScalar(lines, entry.start, entry.end, entry.childIndent, "version");
    if (version !== undefined) return normalizePnpmVersion(version);
  }
  return undefined;
}

interface YamlLine {
  indent: number;
  key: string;
  value: string;
}

/** Parses one `<indent><key>:` or `<indent><key>: <value>` line. A quoted key may itself contain `:` or `@`. Returns undefined for a blank line or a line without a recognizable `key:` shape (a plain scalar or sequence item). */
function parseYamlLine(line: string): YamlLine | undefined {
  const indentMatch = /^( *)(.*)$/.exec(line);
  if (!indentMatch) return undefined;
  const indent = indentMatch[1]!.length;
  const rest = indentMatch[2]!;
  if (rest.length === 0 || rest.startsWith("#")) return undefined;

  let key: string;
  let remainder: string;
  if (rest.startsWith("'") || rest.startsWith("\"")) {
    const quote = rest[0]!;
    const endQuote = rest.indexOf(quote, 1);
    if (endQuote === -1) return undefined;
    key = rest.slice(1, endQuote);
    remainder = rest.slice(endQuote + 1);
  } else {
    const colonIndex = rest.indexOf(":");
    if (colonIndex === -1) return undefined;
    key = rest.slice(0, colonIndex);
    remainder = rest.slice(colonIndex);
  }
  remainder = remainder.trimStart();
  if (!remainder.startsWith(":")) return undefined;
  return { indent, key, value: remainder.slice(1).trim() };
}

/** Finds a direct child `key:` line at exactly `parentIndent` within [start, end) and returns the line range of its nested block (every following line indented deeper, until indentation returns to parentIndent or shallower). Returns undefined if the key is absent or has no nested block (an inline scalar, not a mapping). */
function findYamlBlock(
  lines: readonly string[],
  start: number,
  end: number,
  parentIndent: number,
  key: string,
): { childIndent: number; start: number; end: number } | undefined {
  for (let index = start; index < end; index += 1) {
    const parsed = parseYamlLine(lines[index]!);
    if (!parsed || parsed.indent !== parentIndent || parsed.key !== key) continue;
    let blockEnd = index + 1;
    let childIndent: number | undefined;
    while (blockEnd < end) {
      const next = parseYamlLine(lines[blockEnd]!);
      if (next) {
        if (next.indent <= parentIndent) break;
        childIndent ??= next.indent;
      }
      blockEnd += 1;
    }
    if (childIndent === undefined) return undefined;
    return { childIndent, start: index + 1, end: blockEnd };
  }
  return undefined;
}

/** Finds a direct child `key: value` scalar line at exactly `indent` within [start, end). */
function findYamlScalar(
  lines: readonly string[],
  start: number,
  end: number,
  indent: number,
  key: string,
): string | undefined {
  for (let index = start; index < end; index += 1) {
    const parsed = parseYamlLine(lines[index]!);
    if (parsed && parsed.indent === indent && parsed.key === key) return parsed.value;
  }
  return undefined;
}

function normalizePnpmVersion(value: string): string {
  const base = (value.split("(")[0] ?? "").trim();
  if (
    (base.startsWith("'") && base.endsWith("'") && base.length >= 2) ||
    (base.startsWith("\"") && base.endsWith("\"") && base.length >= 2)
  ) {
    return base.slice(1, -1);
  }
  return base;
}

/**
 * Classic Yarn v1's `yarn.lock` is its own bespoke format, not YAML: a
 * flat list of blocks, each headed by one or more comma-separated
 * `"<name>@<range>"` specifiers (quoted only when necessary) ending in a
 * bare `:`, followed by space-indented `key value` lines with no colon
 * after the key. Yarn Berry (v2+) reuses the `.lock` extension for a
 * materially different, real-YAML format keyed by `resolution:`/`version:`
 * pairs and identified by a top-level `__metadata:` block; that format is
 * out of scope here and must fall closed to "cannot confirm" rather than
 * be misparsed as classic.
 */
function resolveYarnClassicVersion(lockfile: ProjectLockfile, packageName: string): string | undefined {
  const text = Buffer.from(lockfile.bytes).toString("utf8");
  if (/^__metadata:/m.test(text)) return undefined;

  // Unlike npm's node_modules/<name>, pnpm's importers, or Bun's packages
  // map, classic yarn.lock has no single "the top-level resolution" marker:
  // every distinct range that resolved to a distinct version gets its own
  // top-level block, hoisted or not. Collecting every matching block's
  // version and requiring them to agree — rather than trusting whichever
  // block appears first — avoids silently picking the wrong one of two
  // coexisting versions.
  const lines = text.split("\n");
  const versions = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.length === 0 || line.startsWith("#") || line.startsWith(" ") || line.startsWith("\t") || !line.endsWith(":")) {
      index += 1;
      continue;
    }
    const header = line.slice(0, -1);
    const blockStart = index + 1;
    let blockEnd = blockStart;
    while (blockEnd < lines.length && lines[blockEnd]!.startsWith(" ")) blockEnd += 1;

    if (yarnClassicSpecifiers(header).some((specifier) => yarnClassicSpecifierName(specifier) === packageName)) {
      for (let cursor = blockStart; cursor < blockEnd; cursor += 1) {
        const match = /^\s+version\s+"([^"]+)"\s*$/.exec(lines[cursor]!);
        if (match?.[1] !== undefined) {
          versions.add(match[1]);
          break;
        }
      }
    }
    index = blockEnd > blockStart ? blockEnd : index + 1;
  }
  return versions.size === 1 ? [...versions][0] : undefined;
}

function yarnClassicSpecifiers(header: string): string[] {
  const specifiers: string[] = [];
  const pattern = /"([^"]+)"|([^,\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header))) {
    const specifier = match[1] ?? match[2] ?? "";
    if (specifier.length > 0) specifiers.push(specifier);
  }
  return specifiers;
}

function yarnClassicSpecifierName(specifier: string): string | undefined {
  const separator = specifier.lastIndexOf("@");
  if (separator <= 0) return undefined;
  return specifier.slice(0, separator);
}

/** A minimal, dependency-free JSONC reader: strips line and block comments and trailing commas outside string literals, then parses as strict JSON. Bun's bun.lock is JSONC, matching this project's zero-added-runtime-dependency posture. */
function parseJsonWithComments(text: string): unknown {
  return JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(text)));
}

function stripJsoncComments(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      result += char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

function stripJsoncTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      result += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead]!)) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") continue;
    }
    result += char;
  }
  return result;
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
