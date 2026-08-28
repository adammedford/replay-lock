import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { findProjectConfiguration } from "./project-configuration.js";
import { isObject, type CaseArtifact } from "./model.js";
import { emptyPackageCatalog, type PackageCatalog, type PackageCatalogEntry } from "./package-catalog.js";
import type { TrustedPackageDiagnosticCode } from "./adapters.js";

const require = createRequire(import.meta.url);

export type AdapterValidationCode =
  | "VALUE_ADAPTER_MISSING"
  | "VALUE_ADAPTER_VERSION_MISMATCH"
  | "VALUE_ADAPTER_DESERIALIZE_FAILED"
  | "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH"
  | "VALUE_ADAPTER_ROUNDTRIP_MISMATCH"
  | "VALUE_ADAPTER_VALIDATION_TIMEOUT"
  | "VALUE_ADAPTER_VALIDATOR_FAILED"
  | "VALUE_ADAPTER_CONFIG_LOAD_FAILED"
  | "VALUE_ADAPTER_REGISTRY_FAILED";

export type AdapterValidationDetailCode =
  | "VALUE_ADAPTER_LOOKUP_FAILED"
  | "VALUE_ADAPTER_PROTOTYPE_MISMATCH"
  | "VALUE_ADAPTER_DEFINITION_INVALID"
  | "VALUE_ADAPTER_ID_INVALID"
  | "VALUE_ADAPTER_VERSION_INVALID"
  | "VALUE_ADAPTER_TOKEN_INVALID"
  | "VALUE_ADAPTER_BUILTIN_PROTOTYPE"
  | "VALUE_ADAPTER_ID_DUPLICATE"
  | "VALUE_ADAPTER_PROTOTYPE_DUPLICATE";

export interface AdapterValidation {
  ok: boolean;
  code?: AdapterValidationCode;
  detailCode?: AdapterValidationDetailCode;
}

interface ProjectAdapterValidationOptions {
  root: string;
  documents?: readonly unknown[];
  environment: "recording" | "replay";
}

export type AcceptedCaseReplay =
  | { status: "verified"; count: number }
  | { status: "behavioral-failure" }
  | { status: "infrastructure-failure"; diagnostic?: string };

const adapterCodes = new Set<AdapterValidationCode>([
  "VALUE_ADAPTER_MISSING",
  "VALUE_ADAPTER_VERSION_MISMATCH",
  "VALUE_ADAPTER_DESERIALIZE_FAILED",
  "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH",
  "VALUE_ADAPTER_ROUNDTRIP_MISMATCH",
  "VALUE_ADAPTER_VALIDATOR_FAILED",
  "VALUE_ADAPTER_CONFIG_LOAD_FAILED",
  "VALUE_ADAPTER_REGISTRY_FAILED",
]);

export async function validateProjectAdapters(
  options: ProjectAdapterValidationOptions,
): Promise<AdapterValidation[]> {
  if (options.documents !== undefined) {
    return validateAdapterDocuments(options.root, options.documents, options.environment);
  }
  if (!await findProjectConfiguration(options.root)) return [{ ok: true }];
  // This id is intentionally outside the public grammar. A valid registry
  // loads successfully and reports only that the probe adapter is missing.
  const probe = {
    kind: "adapted",
    adapterId: "!replaylock-configuration-probe!",
    version: 1,
    payload: { kind: "null" },
  };
  const result = (await validateAdapterDocuments(
    options.root,
    [probe],
    options.environment,
  ))[0];
  return [result?.code === "VALUE_ADAPTER_MISSING"
    ? { ok: true }
    : result && !result.ok
      ? result
      : { ok: false, code: "VALUE_ADAPTER_VALIDATOR_FAILED" }];
}

export type PackageCatalogFailureCode = "TRUSTED_PACKAGE_CONFIG_LOAD_FAILED" | "TRUSTED_PACKAGE_REGISTRY_FAILED";

export interface PackageCatalogResolution {
  ok: boolean;
  code?: PackageCatalogFailureCode;
  detailCode?: TrustedPackageDiagnosticCode;
  catalog?: PackageCatalog;
}

/**
 * Load `replaylock.config.ts` through the same Vite SSR path used for value
 * adapters (project config imports may use `.js` specifiers that resolve to
 * `.ts` sources, which plain Node import() cannot follow) and build the
 * resolved trusted-package catalog from it.
 */
export async function resolveProjectPackageCatalog(
  root: string,
  environment: "recording" | "replay",
): Promise<PackageCatalogResolution> {
  const configurationPath = await findProjectConfiguration(root);
  if (!configurationPath) return { ok: true, catalog: emptyPackageCatalog };

  const directory = path.join(root, ".replaylock", "catalog", randomUUID());
  const outputPath = path.join(directory, "result.json");
  const runnerPath = path.join(directory, "runner.mjs");
  const packageCatalogUrl = new URL("./package-catalog.js", import.meta.url).href;
  const viteUrl = pathToFileURL(require.resolve("vite")).href;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(runnerPath, [
    `import { writeFileSync } from "node:fs";`,
    `import { createServer } from ${JSON.stringify(viteUrl)};`,
    `import { validateTrustedPackages } from ${JSON.stringify(packageCatalogUrl)};`,
    `import { TrustedPackageConfigurationError } from ${JSON.stringify(new URL("./adapters.js", import.meta.url).href)};`,
    `const configurationSpecifier = ${JSON.stringify(`/${path.relative(root, configurationPath).replaceAll(path.sep, "/")}`)};`,
    `let server;`,
    `let result;`,
    `let stage = "server";`,
    `try {`,
    `  server = await createServer({ root: ${JSON.stringify(root)}, appType: "custom", server: { middlewareMode: true } });`,
    `  stage = "config";`,
    `  const loaded = await server.ssrLoadModule(configurationSpecifier);`,
    `  stage = "catalog";`,
    `  const catalog = validateTrustedPackages(loaded.default);`,
    `  result = { ok: true, entries: catalog.entries };`,
    `} catch (error) {`,
    `  const detailCode = stage === "catalog" && error instanceof TrustedPackageConfigurationError ? error.code : undefined;`,
    `  const code = stage === "config" ? "TRUSTED_PACKAGE_CONFIG_LOAD_FAILED" : "TRUSTED_PACKAGE_REGISTRY_FAILED";`,
    `  result = { ok: false, code, ...(detailCode ? { detailCode } : {}) };`,
    `} finally {`,
    `  if (server) await server.close();`,
    `}`,
    `writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(result), { encoding: "utf8", mode: 0o600 });`,
  ].join("\n"), { encoding: "utf8", mode: 0o600 });

  try {
    const outcome = await runValidatorProcess(runnerPath, directory, environment);
    if (outcome !== "success") return { ok: false, code: "TRUSTED_PACKAGE_REGISTRY_FAILED" };
    const parsed = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    return parsePackageCatalogResolution(parsed);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parsePackageCatalogResolution(value: unknown): PackageCatalogResolution {
  if (isObject(value) && value.ok === true && Array.isArray(value.entries)) {
    return { ok: true, catalog: Object.freeze({ entries: Object.freeze(value.entries as PackageCatalogEntry[]) }) };
  }
  if (isObject(value) && value.ok === false && typeof value.code === "string") {
    return {
      ok: false,
      code: value.code as PackageCatalogFailureCode,
      ...(typeof value.detailCode === "string" ? { detailCode: value.detailCode as TrustedPackageDiagnosticCode } : {}),
    };
  }
  return { ok: false, code: "TRUSTED_PACKAGE_REGISTRY_FAILED" };
}

export async function replayAcceptedCases(options: {
  root: string;
  cases: readonly CaseArtifact[];
}): Promise<AcceptedCaseReplay> {
  const directory = path.join(options.root, ".replaylock", "verify", randomUUID());
  const harnessPath = path.join(directory, "replaylock.verify.test.ts");
  const configPath = path.join(directory, "vitest.config.mjs");
  const behavioralFailurePath = path.join(directory, "behavioral-failures");
  const projectConfiguration = await findProjectConfiguration(options.root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    harnessPath,
    verificationHarness(
      options.cases,
      options.root,
      directory,
      behavioralFailurePath,
      projectConfiguration,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  const harnessLocator = path.relative(options.root, harnessPath).replaceAll(path.sep, "/");
  await writeFile(
    configPath,
    `export default { root: ${JSON.stringify(options.root)}, test: { include: [${JSON.stringify(harnessLocator)}] } };\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    const vitestPackage = require.resolve("vitest/package.json");
    const vitestBinary = path.join(path.dirname(vitestPackage), "vitest.mjs");
    const environment = sanitizedEnvironment("replay");
    const outcome = await runIsolatedProcess(
      process.execPath,
      [vitestBinary, "run", "--config", configPath, harnessLocator],
      options.root,
      environment,
      "inherit",
    );
    if (outcome.signal) {
      return {
        status: "infrastructure-failure",
        diagnostic: `Replay process terminated by ${outcome.signal}`,
      };
    }
    if (outcome.code !== 0) {
      return (await readTextIfPresent(behavioralFailurePath)) === undefined
        ? { status: "infrastructure-failure" }
        : { status: "behavioral-failure" };
    }
    return { status: "verified", count: options.cases.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function validateAdapterDocuments(
  root: string,
  documents: readonly unknown[],
  environment: "recording" | "replay",
): Promise<AdapterValidation[]> {
  if (documents.length > 1) {
    return mapWithConcurrency(documents, 4, async (document) =>
      (await validateAdapterDocuments(root, [document], environment))[0] ?? {
        ok: false,
        code: "VALUE_ADAPTER_VALIDATOR_FAILED",
      });
  }
  if (documents.length === 0 || !documents.some(containsAdaptedNode)) {
    return documents.map(() => ({ ok: true }));
  }
  const directory = path.join(root, ".replaylock", "validate", randomUUID());
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "result.json");
  const runnerPath = path.join(directory, "runner.mjs");
  const configurationPath = await findProjectConfiguration(root);
  const adapterValidatorUrl = new URL("./adapter-validator.js", import.meta.url).href;
  const adaptersUrl = new URL("./adapters.js", import.meta.url).href;
  const viteUrl = pathToFileURL(require.resolve("vite")).href;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(inputPath, JSON.stringify(documents), { encoding: "utf8", mode: 0o600 });
  await writeFile(runnerPath, [
    `import { readFileSync, writeFileSync } from "node:fs";`,
    `import { createServer } from ${JSON.stringify(viteUrl)};`,
    `import { validateAdaptedDocuments } from ${JSON.stringify(adapterValidatorUrl)};`,
    `import { createValueAdapterRegistry, emptyValueAdapterRegistry, ValueAdapterConfigurationError } from ${JSON.stringify(adaptersUrl)};`,
    `const documents = JSON.parse(readFileSync(${JSON.stringify(inputPath)}, "utf8"));`,
    `let server;`,
    `let results;`,
    `let stage = "server";`,
    `try {`,
    ...(configurationPath ? [
      `  server = await createServer({ root: ${JSON.stringify(root)}, appType: "custom", server: { middlewareMode: true } });`,
      `  stage = "config";`,
      `  const loaded = await server.ssrLoadModule(${JSON.stringify(`/${path.relative(root, configurationPath).replaceAll(path.sep, "/")}`)});`,
      `  stage = "registry";`,
      `  const registry = createValueAdapterRegistry(loaded.default);`,
      `  stage = "validation";`,
      `  results = validateAdaptedDocuments(documents, registry);`,
    ] : [
      `  results = validateAdaptedDocuments(documents, emptyValueAdapterRegistry);`,
    ]),
    `} catch (error) {`,
    `  const detailCode = stage === "registry" && error instanceof ValueAdapterConfigurationError ? error.code : undefined;`,
    `  const code = stage === "config" ? "VALUE_ADAPTER_CONFIG_LOAD_FAILED" : stage === "registry" ? "VALUE_ADAPTER_REGISTRY_FAILED" : "VALUE_ADAPTER_VALIDATOR_FAILED";`,
    `  results = documents.map(() => ({ ok: false, code, ...(detailCode ? { detailCode } : {}) }));`,
    `} finally {`,
    `  if (server) await server.close();`,
    `}`,
    `writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(results), { encoding: "utf8", mode: 0o600 });`,
  ].join("\n"), { encoding: "utf8", mode: 0o600 });

  try {
    const outcome = await runValidatorProcess(runnerPath, directory, environment);
    if (outcome === "timeout") {
      return documents.map(() => ({ ok: false, code: "VALUE_ADAPTER_VALIDATION_TIMEOUT" }));
    }
    if (outcome !== "success") {
      return documents.map(() => ({ ok: false, code: "VALUE_ADAPTER_VALIDATOR_FAILED" }));
    }
    const parsed = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== documents.length) {
      return documents.map(() => ({ ok: false, code: "VALUE_ADAPTER_VALIDATOR_FAILED" }));
    }
    return parsed.map(parseAdapterValidation);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseAdapterValidation(value: unknown): AdapterValidation {
  if (isObject(value) && value.ok === true) return { ok: true };
  if (isObject(value) && value.ok === false && adapterCodes.has(value.code as AdapterValidationCode)) {
    return {
      ok: false,
      code: value.code as AdapterValidationCode,
      ...(typeof value.detailCode === "string"
        ? { detailCode: value.detailCode as AdapterValidationDetailCode }
        : {}),
    };
  }
  return { ok: false, code: "VALUE_ADAPTER_VALIDATOR_FAILED" };
}

function containsAdaptedNode(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ((value as { kind?: unknown }).kind === "adapted") return true;
  if (Array.isArray(value)) return value.some(containsAdaptedNode);
  return Object.values(value).some(containsAdaptedNode);
}

function runValidatorProcess(
  runnerPath: string,
  root: string,
  environmentKind: "recording" | "replay",
): Promise<"success" | "failure" | "timeout"> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath], {
      cwd: root,
      env: sanitizedEnvironment(environmentKind),
      stdio: "ignore",
      shell: false,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(timedOut ? "timeout" : code === 0 ? "success" : "failure");
    });
  });
}

function sanitizedEnvironment(kind: "recording" | "replay"): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.REPLAYLOCK_SESSION_DIR;
  delete environment.REPLAYLOCK_SESSION_TOKEN;
  if (kind === "replay") {
    environment.REPLAYLOCK_CLI_PID = String(process.pid);
    environment.VITEST = "true";
  } else {
    delete environment.REPLAYLOCK_CLI_PID;
    delete environment.VITEST;
  }
  return environment;
}

function runIsolatedProcess(
  command: string,
  arguments_: string[],
  root: string,
  environment: NodeJS.ProcessEnv,
  stdio: "inherit",
): Promise<{ code: number; signal?: NodeJS.Signals }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: environment,
      stdio,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(signal ? { code: 2, signal } : { code: code ?? 2 });
    });
  });
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= inputs.length) return;
      const input = inputs[index];
      if (input !== undefined) results[index] = await operation(input);
    }
  });
  await Promise.all(workers);
  return results;
}

function verificationHarness(
  cases: readonly CaseArtifact[],
  root: string,
  harnessDirectory: string,
  behavioralFailurePath: string,
  projectConfiguration: string | undefined,
): string {
  const safetyModuleUrl = new URL("./observation-safety.js", import.meta.url).href;
  const canonicalModuleUrl = new URL("./canonical.js", import.meta.url).href;
  const adaptersModuleUrl = new URL("./adapters.js", import.meta.url).href;
  const imports = cases.map((artifact, index) => {
    let moduleSpecifier = path
      .relative(harnessDirectory, path.join(root, artifact.locator.module))
      .replaceAll(path.sep, "/");
    if (!moduleSpecifier.startsWith(".")) moduleSpecifier = `./${moduleSpecifier}`;
    return `import * as target${index} from ${JSON.stringify(moduleSpecifier)};`;
  });
  const tests = cases.map((artifact, index) => {
    const expected = JSON.stringify(artifact.completion);
    const canonicalArguments = JSON.stringify(artifact.arguments);
    const exportName = JSON.stringify(artifact.locator.exportName);
    const comparisonMode = JSON.stringify(artifact.comparison);
    const locator = `${artifact.locator.module}#${artifact.locator.exportName}`;
    return `test(${JSON.stringify(`ReplayLock ${artifact.caseId}`)}, async () => {
  const decodedArguments = decodeCanonicalValue(${canonicalArguments}, valueAdapterRegistry);
  if (!Array.isArray(decodedArguments)) throw new Error("CASE_SCHEMA_UNSUPPORTED: canonical arguments did not decode to an array");
  let completion;
  try {
    // Awaiting a synchronous target's already-resolved return value is a
    // no-op; this one branch replays both sync and async cases correctly.
    completion = { kind: "return", value: await target${index}[${exportName}](...decodedArguments) };
  } catch (error) {
    completion = { kind: "throw", value: error };
  }
  const expected = ${expected};
  if (completion.kind !== expected.kind) {
    failBehavior(${JSON.stringify("COMPLETION_KIND_MISMATCH")}, ${JSON.stringify(locator)},
      \`expected \${expected.kind}; received \${completion.kind}\`);
  }
  const stdoutWrite = Object.getOwnPropertyDescriptor(process.stdout, "write");
  const stderrWrite = Object.getOwnPropertyDescriptor(process.stderr, "write");
  let classified;
  try {
    Object.defineProperty(process.stdout, "write", { configurable: true, value() { return true; } });
    Object.defineProperty(process.stderr, "write", { configurable: true, value() { return true; } });
    classified = classifyObservation({
      locator: ${JSON.stringify(artifact.locator)},
      entryArguments: [],
      exitArguments: [],
      completion,
    }, { valueAdapters: valueAdapterRegistry });
  } finally {
    if (stdoutWrite) Object.defineProperty(process.stdout, "write", stdoutWrite);
    if (stderrWrite) Object.defineProperty(process.stderr, "write", stderrWrite);
  }
  if (!classified.safe) {
    failBehavior(classified.code === "VALUE_ADAPTER_SERIALIZE_FAILED" ? classified.code : ${JSON.stringify("OUTPUT_MISMATCH")}, ${JSON.stringify(locator)},
      "expected " + displayCompletion(expected) + "; received [REDACTED]");
  }
  const actual = classified.observation.completion;
  if (!completionsMatch(expected, actual, ${comparisonMode})) {
    failBehavior(${JSON.stringify("OUTPUT_MISMATCH")}, ${JSON.stringify(locator)}, firstDifference(expected, actual));
  }
});`;
  });
  return [
    `import { test } from "vitest";`,
    `import { appendFileSync } from "node:fs";`,
    `import { classifyObservation } from ${JSON.stringify(safetyModuleUrl)};`,
    `import { decodeCanonicalValue } from ${JSON.stringify(canonicalModuleUrl)};`,
    `import { createValueAdapterRegistry, emptyValueAdapterRegistry } from ${JSON.stringify(adaptersModuleUrl)};`,
    ...(projectConfiguration
      ? [`import replaylockConfiguration from ${JSON.stringify(relativeModuleSpecifier(harnessDirectory, projectConfiguration))};`]
      : []),
    ...imports,
    "",
    projectConfiguration
      ? `const valueAdapterRegistry = createValueAdapterRegistry(replaylockConfiguration);`
      : `const valueAdapterRegistry = emptyValueAdapterRegistry;`,
    `const behavioralFailurePath = ${JSON.stringify(behavioralFailurePath)};`,
    `function failBehavior(code, locator, detail) {`,
    `  appendFileSync(behavioralFailurePath, code + "\\n", { encoding: "utf8", mode: 0o600 });`,
    `  throw new Error(code + " " + locator + ": " + detail);`,
    `}`,
    // An opt-in, review-time-only decision (see acceptReviewedCandidate in
    // review.ts): number leaves compare within epsilon, every other kind
    // (string/boolean/null/array length/record keys/adapted identity) still
    // requires exact equality. For "exact" comparison this is behaviorally
    // identical to a raw JSON.stringify comparison, since canonical record
    // entries are always persisted in sorted key order.
    `function completionsMatch(expected, actual, comparisonMode) {`,
    `  if (expected.kind !== actual.kind) return false;`,
    `  if (expected.error || actual.error) {`,
    `    return !!expected.error && !!actual.error && expected.error.name === actual.error.name && expected.error.message === actual.error.message;`,
    `  }`,
    `  return valuesMatch(expected.value, actual.value, comparisonMode);`,
    `}`,
    `function valuesMatch(expected, actual, comparisonMode) {`,
    `  const epsilon = comparisonMode && comparisonMode.kind === "tolerance" ? comparisonMode.epsilon : undefined;`,
    `  if (!expected || !actual || expected.kind !== actual.kind) return JSON.stringify(expected) === JSON.stringify(actual);`,
    `  if (expected.kind === "number" && epsilon !== undefined) return Math.abs(expected.value - actual.value) <= epsilon;`,
    `  if (expected.kind === "array") {`,
    `    return expected.items.length === actual.items.length && expected.items.every((item, index) => valuesMatch(item, actual.items[index], comparisonMode));`,
    `  }`,
    `  if (expected.kind === "record") {`,
    `    if (expected.entries.length !== actual.entries.length) return false;`,
    `    const actualByKey = new Map(actual.entries.map((entry) => [entry.key, entry.value]));`,
    `    return expected.entries.every((entry) => actualByKey.has(entry.key) && valuesMatch(entry.value, actualByKey.get(entry.key), comparisonMode));`,
    `  }`,
    `  if (expected.kind === "adapted") {`,
    `    return expected.adapterId === actual.adapterId && expected.version === actual.version && valuesMatch(expected.payload, actual.payload, comparisonMode);`,
    `  }`,
    `  return JSON.stringify(expected) === JSON.stringify(actual);`,
    `}`,
    `function displayCompletion(completion) {`,
    `  if (completion.kind === "throw" && completion.error) {`,
    `    return completion.error.name + "(" + JSON.stringify(completion.error.message) + ")";`,
    `  }`,
    `  return displayValue(completion.value);`,
    `}`,
    `function displayValue(value) {`,
    `  if (value.kind === "null") return "null";`,
    `  if (value.kind === "boolean" || value.kind === "number" || value.kind === "string") return JSON.stringify(value.value);`,
    `  if (value.kind === "array") return "[" + value.items.map(displayValue).join(", ") + "]";`,
    `  if (value.kind === "record") return "{" + value.entries.map((entry) => JSON.stringify(entry.key) + ": " + displayValue(entry.value)).join(", ") + "}";`,
    `  return "[canonical " + String(value.kind) + "]";`,
    `}`,
    `function firstDifference(expected, actual) {`,
    `  if (expected.kind === "throw" && expected.error && actual.error) {`,
    `    if (expected.error.name !== actual.error.name) return "$.error.name: expected " + JSON.stringify(expected.error.name) + "; received " + JSON.stringify(actual.error.name);`,
    `    return "$.error.message: expected " + JSON.stringify(expected.error.message) + "; received " + JSON.stringify(actual.error.message);`,
    `  }`,
    `  return valueDifference(expected.value, actual.value, "$");`,
    `}`,
    `function valueDifference(expected, actual, path) {`,
    `  if (expected.kind !== actual.kind) return path + ": expected " + displayValue(expected) + "; received " + displayValue(actual);`,
    `  if (expected.kind === "null") return path + ": canonical null differed";`,
    `  if (expected.kind === "boolean" || expected.kind === "number" || expected.kind === "string") {`,
    `    return path + ": expected " + JSON.stringify(expected.value) + "; received " + JSON.stringify(actual.value);`,
    `  }`,
    `  if (expected.kind === "array") {`,
    `    const length = Math.min(expected.items.length, actual.items.length);`,
    `    for (let index = 0; index < length; index += 1) {`,
    `      if (JSON.stringify(expected.items[index]) !== JSON.stringify(actual.items[index])) return valueDifference(expected.items[index], actual.items[index], path + "[" + index + "]");`,
    `    }`,
    `    return path + ".length: expected " + expected.items.length + "; received " + actual.items.length;`,
    `  }`,
    `  if (expected.kind === "record") {`,
    `    const expectedEntries = new Map(expected.entries.map((entry) => [entry.key, entry.value]));`,
    `    const actualEntries = new Map(actual.entries.map((entry) => [entry.key, entry.value]));`,
    `    for (const key of new Set([...expectedEntries.keys(), ...actualEntries.keys()])) {`,
    `      const nextPath = path + "." + key;`,
    `      if (!expectedEntries.has(key)) return nextPath + ": unexpected value " + displayValue(actualEntries.get(key));`,
    `      if (!actualEntries.has(key)) return nextPath + ": expected " + displayValue(expectedEntries.get(key)) + "; received <missing>";`,
    `      if (JSON.stringify(expectedEntries.get(key)) !== JSON.stringify(actualEntries.get(key))) return valueDifference(expectedEntries.get(key), actualEntries.get(key), nextPath);`,
    `    }`,
    `  }`,
    `  if (expected.kind === "adapted") {`,
    `    if (expected.adapterId !== actual.adapterId) return path + ".adapterId: expected " + JSON.stringify(expected.adapterId) + "; received " + JSON.stringify(actual.adapterId);`,
    `    if (expected.version !== actual.version) return path + ".version: expected " + expected.version + "; received " + actual.version;`,
    `    return valueDifference(expected.payload, actual.payload, path + ".payload");`,
    `  }`,
    `  return path + ": canonical values differed";`,
    `}`,
    "",
    ...tests,
    "",
  ].join("\n");
}

function relativeModuleSpecifier(fromDirectory: string, target: string): string {
  let specifier = path.relative(fromDirectory, target).replaceAll(path.sep, "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

async function readTextIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}
