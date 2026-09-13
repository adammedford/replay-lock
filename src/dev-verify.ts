import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { DevCase, DevEnvironment, DevTarget, ResolvedDevOptions } from "./dev-contract.js";
import { devArtifactJson, parseDevCase } from "./dev-artifacts.js";
import { analyzeDevProject, createDevProjectCache } from "./dev-transform.js";
import { resolveCallableModuleLocator } from "./callable-locator.js";
import { findProjectConfiguration } from "./project-configuration.js";
import { assertDevSafe } from "./dev-values.js";

function failure(code: string, detail: string): never { throw Object.assign(new Error(`${code}: ${detail}`), { code }); }
function identity(target: Pick<DevCase, "locator">): string { return JSON.stringify([target.locator.module, target.locator.kind, target.locator.namePath]); }

export function reportDevVerificationError(error: unknown): void {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "unknown infrastructure failure";
  try { assertDevSafe(message); console.error(`REPLAY_INFRASTRUCTURE_FAILED: ${message.slice(0, 2000)}`); }
  catch { console.error("REPLAY_INFRASTRUCTURE_FAILED"); }
  if (error && typeof error === "object" && "cause" in error && error.cause && error.cause !== error) {
    const cause = error.cause;
    const code = typeof cause === "object" && "message" in cause ? cause.message : undefined;
    if (typeof code === "string") {
      try { assertDevSafe(code); console.error(`REPLAY_INFRASTRUCTURE_FAILED: ${code.slice(0, 2000)}`); }
      catch { /* Keep unsafe project details out of diagnostics. */ }
    }
  }
}

/** Requalify every target from current source without importing project modules. */
export async function preflightDevCases(root: string, cases: readonly DevCase[], options: ResolvedDevOptions): Promise<void> {
  root = await realpath(root);
  const parsed = cases.map((artifact) => parseDevCase(JSON.stringify(artifact)));
  const project = createDevProjectCache(root, options);
  const analyses = new Map<DevEnvironment, Awaited<ReturnType<typeof analyzeDevProject>>>();
  for (const artifact of parsed) {
    const target = `${artifact.locator.module}#${artifact.locator.namePath.join(".")}`;
    const absolute = path.resolve(root, artifact.locator.module);
    const resolved = resolveCallableModuleLocator(root, absolute);
    if (!resolved.ok || resolved.locator !== artifact.locator.module) failure("ORPHANED_CALLABLE", target);
    let analysis = analyses.get(artifact.environment);
    if (!analysis) { analysis = project.analyze(artifact.environment); analyses.set(artifact.environment, analysis); }
    const discovered = analysis.targets.find((entry) => identity(entry) === identity(artifact));
    if (!discovered) {
      const diagnostic = analysis.diagnostics.find((entry) => entry.locator && identity({ locator: entry.locator }) === identity(artifact));
      failure(diagnostic ? "REPLAY_SAFETY_REGRESSION" : "ORPHANED_CALLABLE", `${target}${diagnostic ? ` (${diagnostic.code})` : ""}`);
    }
    const transformed = project.transform({ root, id: absolute, code: await readFile(absolute, "utf8"), environment: artifact.environment, generation: "verify", options, replay: true });
    if (!transformed.targets.some((entry) => identity(entry) === identity(artifact) && entry.replayExport === discovered.replayExport)) failure("REPLAY_SAFETY_REGRESSION", target);
    if (artifact.environment === "node" && !/^v?22\./.test(process.version)) failure("RUNTIME_PROFILE_MISMATCH", "Node 22 is required");
  }
}

/** One fresh child process per case. No generated tests survive verification. */
export async function verifyDevCases(root: string, cases: readonly DevCase[], options: ResolvedDevOptions): Promise<number> {
  try { return await verifyIsolatedCases(root, cases, options); }
  catch (error) { reportDevVerificationError(error); return 2; }
}

/** Finish all realm/profile adapter checks before either version may invoke a target. */
export async function validateDevCaseAdapters(root: string, cases: readonly DevCase[], options: ResolvedDevOptions): Promise<number> {
  try {
    if (!cases.length) return 0;
    root = await realpath(root);
    const parsed = cases.map((artifact) => parseDevCase(JSON.stringify(artifact)));
    if (!await findProjectConfiguration(root) && !parsed.some(containsAdapter)) return 0;
    const groups = new Map<string, DevCase[]>();
    for (const artifact of parsed) {
      const key = devArtifactJson(artifact.provenance.runtimeProfile);
      const group = groups.get(key) ?? [];
      group.push(artifact);
      groups.set(key, group);
    }
    return await runIsolatedGroups(root, [...groups.values()], options, "validate") === 0 ? 0 : 2;
  } catch (error) { reportDevVerificationError(error); return 2; }
}

function containsAdapter(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("kind" in value && value.kind === "adapted") return true;
  return Object.values(value).some(containsAdapter);
}

async function verifyIsolatedCases(root: string, cases: readonly DevCase[], options: ResolvedDevOptions): Promise<number> {
  if (!cases.length) return 0;
  root = await realpath(root);
  try { await preflightDevCases(root, cases, options); }
  catch (error) { console.error(error instanceof Error ? error.message : "REPLAY_PREFLIGHT_FAILED"); return 2; }
  const validation = await validateDevCaseAdapters(root, cases, options);
  if (validation !== 0) return validation;
  const status = await runIsolatedGroups(root, cases.map((artifact) => [artifact]), options, "replay");
  if (status === 0) console.log(`Verified ${cases.length} V2 case(s)`);
  return status;
}

type WorkerPhase = "validate" | "replay";

async function runIsolatedGroups(root: string, groups: readonly DevCase[][], options: ResolvedDevOptions, phase: WorkerPhase): Promise<number> {
  const directory = path.join(root, ".replaylock", "verify");
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(directory, `dev-${phase}-`));
  let status = 0;
  try {
    for (const [index, group] of groups.entries()) {
      const input = path.join(temporary, `input-${index}.json`);
      const runner = path.join(temporary, `runner-${index}.mjs`);
      await writeFile(input, JSON.stringify({ root, cases: group, options, temporary, index, phase }), { mode: 0o600 });
      await writeFile(runner, `import { readFile } from 'node:fs/promises';\nimport { runDevVerificationWorker, reportDevVerificationError } from ${JSON.stringify(import.meta.url)};\ntry { process.exitCode = await runDevVerificationWorker(JSON.parse(await readFile(${JSON.stringify(input)}, 'utf8'))); } catch (error) { reportDevVerificationError(error); process.exitCode = 2; }\n`, { mode: 0o600 });
      const runtime = group[0]!.provenance.runtimeProfile;
      const result = await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [runner], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TZ: runtime.timezone, LANG: `${runtime.locale.replaceAll("-", "_")}.UTF-8`, NO_COLOR: "1", FORCE_COLOR: "0" } });
        let bytes = 0;
        const output = (chunk: Buffer) => { bytes += chunk.length; if (bytes < 1024 * 1024) process.stdout.write(chunk); };
        child.stdout.on("data", output); child.stderr.on("data", output);
        const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 90_000);
        child.once("error", () => { clearTimeout(timeout); console.error("REPLAY_INFRASTRUCTURE_FAILED"); resolve(2); });
        child.once("close", (code) => { clearTimeout(timeout); resolve(code === 0 ? 0 : code === 1 ? 1 : 2); });
      });
      status = Math.max(status, result);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return status;
}

interface WorkerInput { root: string; cases: DevCase[]; options: ResolvedDevOptions; temporary: string; index: number; phase: WorkerPhase }

/** Internal child-process entrypoint; adapters and callables are only loaded by Vitest. */
export async function runDevVerificationWorker(input: WorkerInput): Promise<number> {
  const { root, cases, options, temporary, index, phase } = input;
  await preflightDevCases(root, cases, options);
  const realm = cases[0]!.environment;
  const runtime = cases[0]!.provenance.runtimeProfile;
  const configuration = await findProjectConfiguration(root);
  const project = createDevProjectCache(root, options);
  const analysis = phase === "replay" ? project.analyze(realm) : undefined;
  const targets = analysis ? cases.map((artifact) => analysis.targets.find((entry) => identity(entry) === identity(artifact))!) : [];
  const filename = path.join(temporary, `replay-${index}.test.mjs`);
  await writeFile(filename, harness(cases, targets, configuration, realm, phase), { mode: 0o600 });
  const runtimePath = fileURLToPath(new URL("./dev-runtime.js", import.meta.url));
  const valuesPath = fileURLToPath(new URL("./dev-values.js", import.meta.url));
  const libraryRoot = fileURLToPath(new URL("..", import.meta.url));
  const vitestPath = fileURLToPath(import.meta.resolve("vitest"));
  const aliases = [
    { find: /^vitest$/, replacement: vitestPath },
    { find: "replaylock/dev/runtime", replacement: runtimePath },
    { find: "replaylock/dev/values", replacement: valuesPath },
    { find: "replaylock/dev/diff", replacement: fileURLToPath(new URL("./dev-diff.js", import.meta.url)) },
    { find: /^replaylock$/, replacement: fileURLToPath(new URL(realm === "browser" ? "./dev-browser-api.js" : "./index.js", import.meta.url)) },
  ];
  const plugin: Plugin = {
    name: "replaylock-isolated-v2-replay", enforce: "pre",
    configResolved(config) {
      // Browser Mode adds nested dependency hints relative to the application.
      // Resolve its own hints from ReplayLock's dependency graph instead.
      const include = config.optimizeDeps.include;
      if (include) config.optimizeDeps.include = include.map((entry) => {
        if (!entry.startsWith("vitest > ")) return entry;
        let importer = import.meta.url;
        let resolved = "";
        for (const specifier of entry.split(" > ")) {
          resolved = createRequire(importer).resolve(specifier);
          importer = resolved;
        }
        return resolved;
      });
    },
    transform(code, id) {
      const cleanId = id.split("?")[0]!;
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(cleanId) || cleanId.includes("/node_modules/") || cleanId.startsWith(temporary) || cleanId === configuration || cleanId.startsWith(path.dirname(runtimePath) + path.sep)) return;
      const resolved = resolveCallableModuleLocator(root, cleanId);
      if (!resolved.ok) return;
      const transformed = project.transform({ root, id: cleanId, code, environment: realm, generation: "verify", options, replay: true, runtimeImport: "replaylock/dev/runtime" });
      return { code: transformed.code, map: transformed.map as null };
    },
  };
  let browser: import("vitest/node").TestUserConfig["browser"];
  if (realm === "browser") {
    try {
      const require = createRequire(import.meta.url);
      const providerPath = require.resolve("@vitest/browser-playwright");
      const { playwright } = await import(providerPath) as { playwright: (options: unknown) => NonNullable<NonNullable<typeof browser>["provider"]> };
      browser = { enabled: true, headless: true, api: { host: "127.0.0.1", port: 0 }, provider: playwright({ contextOptions: { timezoneId: runtime.timezone, locale: runtime.locale } }), instances: [{ browser: "chromium" }], screenshotFailures: false };
    } catch { console.error("BROWSER_PROVIDER_MISSING: install @vitest/browser-playwright and Playwright Chromium"); return 2; }
  }
  const { startVitest } = await import("vitest/node");
  let infrastructure = false;
  let failed = false;
  let count = 0;
  const testOptions: import("vitest/node").TestUserConfig = {
    include: [path.relative(root, filename).replaceAll(path.sep, "/")], exclude: [],
    fileParallelism: false, maxWorkers: 1, pool: "forks", environment: "node", testTimeout: 15_000, silent: true,
    ...(browser ? { browser } : {}),
    reporters: [{ onTestRunEnd(modules, errors) {
      infrastructure ||= errors.length > 0;
      for (const error of errors) reportDevVerificationError(error);
      for (const module of modules) {
        infrastructure ||= module.errors().length > 0;
        for (const error of module.errors()) reportDevVerificationError(error);
        for (const test of module.children.allTests()) {
          count++;
          const result = test.result();
          if (result.state !== "passed") {
            failed = true;
            const behavioral = result.state === "failed" && result.errors.every((error) => /(?:OUTPUT_MISMATCH|TRACE_MISMATCH)/.test(error.message));
            infrastructure ||= !behavioral;
            const traceMismatch = result.state === "failed" && result.errors.some((error) => /TRACE_MISMATCH/.test(error.message));
            console.error(behavioral ? `${traceMismatch ? "EFFECT_TRACE_MISMATCH" : "OUTPUT_MISMATCH"} ${test.name}` : `REPLAY_INFRASTRUCTURE_FAILED ${test.name}`);
            if (behavioral && result.state === "failed") for (const error of result.errors) {
              try { assertDevSafe(error.message); console.error(error.message.slice(0, 2000)); }
              catch { /* Unvalidated application values never become diagnostics. */ }
            }
            if (!behavioral && result.state === "failed") for (const error of result.errors) reportDevVerificationError(error);
          }
        }
      }
    } }],
  };
  const { loadConfigFromFile, mergeConfig } = await import("vite");
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, undefined, root, "silent");
  const projectConfig = loaded?.config ?? {};
  projectConfig.plugins = await replayPlugins(projectConfig.plugins ?? []);
  const viteOptions = { ...mergeConfig(projectConfig, { configFile: false, root, plugins: [plugin], resolve: { alias: aliases }, server: { host: "127.0.0.1", fs: { allow: [root, libraryRoot] } } }), root, test: testOptions };
  // Browser Mode starts a separate Vite server from project options. An explicit
  // project carries the same source transforms and aliases into that realm.
  const replayProject = { ...viteOptions, test: { ...testOptions, name: "replaylock-v2" } };
  const rootTestOptions: import("vitest/node").TestUserConfig = { ...testOptions, projects: [replayProject] };
  viteOptions.test = rootTestOptions;
  const context = await startVitest("test", [], { root, config: false, watch: false, run: true }, viteOptions);
  try {
    infrastructure ||= context.state.getUnhandledErrors().length > 0 || count !== cases.length;
    if (count !== cases.length) console.error(`REPLAY_INFRASTRUCTURE_FAILED: expected ${cases.length} tests, collected ${count}`);
    return infrastructure ? 2 : failed ? 1 : 0;
  } finally { await context.close(); }
}

async function replayPlugins(entries: import("vite").PluginOption[]): Promise<Plugin[]> {
  const result: Plugin[] = [];
  for (const entry of entries) {
    const resolved = await entry;
    if (Array.isArray(resolved)) result.push(...await replayPlugins(resolved));
    else if (resolved && resolved.name !== "replaylock:dev" && resolved.name !== "replaylock") result.push(resolved);
  }
  return result;
}

function harness(cases: DevCase[], targets: DevTarget[], configuration: string | undefined, realm: DevEnvironment, phase: WorkerPhase): string {
  const configurationImport = configuration ? `import configuration from ${JSON.stringify(`/@fs/${configuration}`)};` : "const configuration = {};";
  return `import { test } from 'vitest';
import { configureDevRuntime, replayDevTrace } from 'replaylock/dev/runtime';
import { encodeDevValue, decodeDevValue, validateDevAdapters } from 'replaylock/dev/values';
import { describeDevCompletionDifference, describeDevTraceDifference } from 'replaylock/dev/diff';
${realm === "node" ? "import { types } from 'node:util';" : ""}
${configurationImport}
const cases = ${JSON.stringify(cases)};
const targets = ${JSON.stringify(targets)};
const codec = { adapters: configuration.valueAdapters ?? [], ${realm === "node" ? "isProxy: types.isProxy" : ""} };
// Validate all adapter payloads before any callable in this realm is imported.
function validateTree(value) {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'adapted') { decodeDevValue(value, codec); return; }
  for (const item of Array.isArray(value) ? value : Object.values(value)) validateTree(item);
}
let adapterFailure;
try {
  validateDevAdapters(codec.adapters);
  for (const artifact of cases) validateTree(artifact);
} catch (error) {
  adapterFailure = new Error(typeof error?.code === 'string' && /^VALUE_ADAPTER_[A-Z_]+$/.test(error.code) ? error.code : 'VALUE_ADAPTER_VALIDATION_FAILED');
}
configureDevRuntime(undefined);
for (const [index, artifact] of cases.entries()) test(artifact.caseId, async () => {
  if (adapterFailure) throw adapterFailure;
  ${phase === "validate" ? "return;" : ""}
  const module = await import(/* @vite-ignore */ '/' + artifact.locator.module);
  const callable = module[targets[index].replayExport];
  if (typeof callable !== 'function') throw new Error('ORPHANED_CALLABLE');
  const args = decodeDevValue(artifact.arguments, codec);
  let difference;
  try { await replayDevTrace(artifact.trace, async () => {
    let kind = 'return', value;
    try { value = await callable(...args); }
    catch (error) { kind = 'throw'; value = error; }
    difference = describeDevCompletionDifference(artifact, { kind, value }, codec);
  }, codec); }
  catch (error) {
    if (error?.code === 'TRACE_MISMATCH') throw new Error(describeDevTraceDifference(artifact, error.difference));
    throw error;
  }
  if (difference) throw new Error(difference);
});
`;
}
