import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { types as utilTypes } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfigFromFile, type Plugin, type ViteDevServer } from "vite";
import { atomicWrite } from "./model.js";
import { projectLockfileDigest, readProjectLockfile } from "./project-lockfile.js";
import { developmentAliases, loadDevConfiguration } from "./dev-options.js";
import { createDevProjectCache } from "./dev-transform.js";
import { createDevCandidate, persistDevObservations } from "./dev-artifacts.js";
import { configureDevRuntime, flushDevRuntime, runtimeProfile } from "./dev-runtime.js";
import { loadDevRetention } from "./dev-retention.js";
import type { DevRetentionSnapshot } from "./dev-retention.js";
import { createDevSessionReport, parseDevCounts, parseDevMetadata, readDevSessionReport } from "./dev-report.js";
import type { DevActivity, DevBlock, DevObservation, DevRetentionPolicy, DevRuntimeProfile } from "./dev-contract.js";

const prefix = "__replaylock";
const virtualRuntime = "virtual:replaylock/dev-runtime";
const runtimePath = fileURLToPath(new URL("./dev-runtime.js", import.meta.url));
const clientPath = fileURLToPath(new URL("./dev-client.js", import.meta.url));
const packageRoot = realpathSync(path.resolve(path.dirname(runtimePath), ".."));
const filesystemUrl = (file: string): string => `/@fs/${file.split(path.sep).join("/")}`;
interface Manifest { root: string; url: string; token: string; pid: number; launch?: string }
interface StoredObservation { observation: DevObservation; profile: DevRuntimeProfile }

export function devRecordingPlugin(): Plugin {
  const launch = process.env.REPLAYLOCK_DEV_START;
  let root = "";
  let server: ViteDevServer | undefined;
  let disposeHost = async (): Promise<void> => {};
  let configuration: Awaited<ReturnType<typeof loadDevConfiguration>>;
  let project: ReturnType<typeof createDevProjectCache>;
  let retention: Awaited<ReturnType<typeof loadDevRetention>>;
  let report: ReturnType<typeof createDevSessionReport> | undefined;
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let recording = false, stopping = false, accepting = false, generation = 0;
  let session = "", sessionDirectory = "", lockfileDigest = "", sessionToken = "";
  let stored = 0, blocks = 0;
  let completed: Record<string, unknown> | undefined;
  let pendingWrites: Promise<void> = Promise.resolve();
  let manifestPath: string | undefined;
  const controlToken = randomBytes(32).toString("hex");
  const acknowledged = new Map<string, number>();
  const appliedCounts = new Map<string, number>();
  const appliedObservations = new Map<string, { sequence: number; persist(): Promise<void> }>();
  const clientWrites = new Map<string, Promise<void>>();
  const activeClients = new Set<string>();
  const knownMetadata = new Set<string>();
  const diagnostics = new Set<string>();
  const profiles = { node: runtimeProfile("node"), browser: { environment: "browser", runtime: "Chromium", timezone: "UTC", locale: "en-US" } as DevRuntimeProfile };
  const recordBlock = (block: DevBlock): void => {
    blocks++;
    report?.block(block);
    if (!diagnostics.has(block.code)) { diagnostics.add(block.code); console.error(`ReplayLock ${block.code}`); }
  };
  function checkpoint(): Promise<void> {
    const write = pendingWrites.then(async () => {
      if (!report) return;
      await atomicWrite(path.join(sessionDirectory, "report.json"), JSON.stringify(report.snapshot(completed ? (blocks ? "partial" : "complete") : "recording")));
      await atomicWrite(path.join(sessionDirectory, "admission.json"), JSON.stringify(retention.snapshot()));
    });
    pendingWrites = write.catch(() => recordBlock({ code: "STORE_WRITE_FAILED" }));
    return write;
  }
  function activity(event: DevActivity): void {
    if (!knownMetadata.has(metadataKey(event.metadata))) return;
    report?.counts([{ metadata: event.metadata, invoked: event.kind === "invoked" ? 1 : 0, completed: event.kind === "completed" ? 1 : 0 }]);
    if (!checkpointTimer) checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      void checkpoint().catch(() => {});
    }, 250);
  }
  function metadataKey(observation: Pick<DevObservation, "locator" | "environment" | "generation" | "sourceGraphDigest">): string {
    return JSON.stringify([observation.locator, observation.environment, observation.generation, observation.sourceGraphDigest]);
  }
  function prepareObservation(observation: DevObservation, profile: DevRuntimeProfile): () => Promise<void> {
    if (!accepting) throw new Error("SESSION_NOT_ACTIVE");
    if (!knownMetadata.has(metadataKey(observation))) throw new Error("INCOMPLETE_OBSERVATION");
    const candidate = createDevCandidate(observation, lockfileDigest, profile);
    const admission = retention.admit(candidate);
    report?.observation(observation, admission.status);
    if (admission.status === "limit") { recordBlock({ code: admission.reason ?? "PENDING_LIMIT", metadata: parseDevMetadata({ locator: observation.locator, environment: observation.environment, generation: observation.generation, sourceGraphDigest: observation.sourceGraphDigest }) }); return () => Promise.resolve(); }
    if (admission.status === "omitted") return () => Promise.resolve();
    profiles[observation.environment] = profile;
    const filename = `${String(++stored).padStart(10, "0")}.json`;
    const destination = path.join(sessionDirectory, filename);
    const contents = JSON.stringify({ observation, profile } satisfies StoredObservation);
    // A transport retry repeats this write, never admission or report accounting.
    return () => {
      const write = pendingWrites.then(() => atomicWrite(destination, contents));
      pendingWrites = write.catch(() => { recordBlock({ code: "STORE_WRITE_FAILED" }); });
      return write;
    };
  }
  function accept(observation: DevObservation, profile: DevRuntimeProfile): Promise<void> {
    return prepareObservation(observation, profile)();
  }
  function invalidate(preserveAnalysis = false): void {
    generation++;
    if (!preserveAnalysis) project?.invalidate();
    for (const environment of Object.values(server?.environments ?? {})) environment.moduleGraph.invalidateAll();
    server?.ws.send({ type: "full-reload" });
  }
  async function configureNode(): Promise<void> {
    if (configuration.configurationPath && configuration.adapters.length) {
      const module = await server!.ssrLoadModule(configuration.configurationPath);
      configuration.adapters = module.default.valueAdapters ?? [];
    }
    configureDevRuntime({ adapters: configuration.adapters, isProxy: utilTypes.isProxy,
      onObservation: observation => { void accept(observation, profiles.node).catch(() => recordBlock({ code: "STORE_WRITE_FAILED" })); }, onBlock: recordBlock, onActivity: activity });
  }
  async function start(): Promise<void> {
    if (recording || stopping) throw new Error("SESSION_ALREADY_ACTIVE");
    configuration = await loadDevConfiguration(root, server?.config);
    configuration.options.resolveAliases = developmentAliases(server?.config.resolve.alias ?? [], true);
    project = createDevProjectCache(root, configuration.options);
    lockfileDigest = projectLockfileDigest(await readProjectLockfile(root));
    const reports = (["node", "browser"] as const).map(environment => project.analyze(environment));
    const eligible = reports.reduce((count, report) => count + report.targets.length, 0);
    if (!eligible) throw new Error("NO_ELIGIBLE_TARGET");
    console.log(`ReplayLock: ${eligible} eligible environment targets; ${reports.reduce((count, report) => count + report.diagnostics.length, 0)} skipped findings`);
    session = randomUUID(); sessionToken = randomBytes(32).toString("hex");
    retention = await loadDevRetention(root, configuration.options.capture.retention);
    report = createDevSessionReport(session);
    sessionDirectory = path.join(root, ".replaylock", "observations", "dev-sessions", session);
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    await atomicWrite(path.join(sessionDirectory, "metadata.json"), JSON.stringify({ lockfileDigest, profiles, pid: process.pid, retention: retention.policy }));
    stored = 0; blocks = 0; completed = undefined; knownMetadata.clear(); diagnostics.clear(); acknowledged.clear(); appliedCounts.clear(); appliedObservations.clear(); clientWrites.clear(); activeClients.clear();
    recording = true; accepting = true;
    invalidate(true);
    for (const [index, environment] of (["node", "browser"] as const).entries()) report.discover(reports[index]!, environment, String(generation).padStart(10, "0"));
    await checkpoint();
    try { await configureNode(); }
    catch (error) { recording = false; accepting = false; configureDevRuntime(undefined); invalidate(); throw error; }
    console.log(`ReplayLock RECORDING ${session}`);
  }
  async function stop(): Promise<unknown> {
    if (!recording) throw new Error("SESSION_NOT_ACTIVE");
    stopping = true; recording = false;
    server?.ws.send({ type: "custom", event: "replaylock:stop", data: {} });
    await Promise.all([flushDevRuntime(5000), new Promise(resolve => setTimeout(resolve, 5000))]);
    accepting = false;
    configureDevRuntime(undefined);
    await Promise.all(clientWrites.values());
    await pendingWrites;
    if (checkpointTimer) { clearTimeout(checkpointTimer); checkpointTimer = undefined; }
    if (activeClients.size) recordBlock({ code: "INCOMPLETE_OBSERVATION" });
    const entries = await readStored(sessionDirectory);
    const observations = entries.map(entry => entry.observation);
    const result = await persistDevObservations(root, observations, lockfileDigest, profiles, {
      captureStatus: blocks ? "partial" : "complete",
      retention: retention.policy, retentionState: retention.snapshot(), retentionSealed: true,
      observationProfiles: entries.map(entry => entry.profile), completedGenerations: [...new Set(observations.map(observation => observation.generation))].sort(),
    });
    for (const block of result.blocks) recordBlock(block);
    await atomicWrite(path.join(sessionDirectory, "result.json"), JSON.stringify({ ...result, session, recordingBlocks: blocks }));
    completed = { ...result, session, recordingBlocks: blocks };
    await checkpoint();
    stopping = false; invalidate();
    console.log(`ReplayLock: recorded ${observations.length} completed observations; ${result.candidates} pending candidates`);
    return completed;
  }
  function endpoint(): string { return `${server?.config.base ?? "/"}${prefix}`; }
  async function middleware(request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> {
    const requestedPath = (request.url ?? "").split("?", 1)[0]!;
    if (!requestedPath.startsWith(`${endpoint()}/`)) { next(); return; }
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "application/json");
    try {
      if (!isLoopback(request.socket.remoteAddress ?? "") || !isLocalHost(request.headers.host ?? "")) throw new Error("LOCAL_ONLY");
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new Error("INVALID_ORIGIN");
      const ingestion = requestedPath === `${endpoint()}/observations`;
      const expectedToken = ingestion ? sessionToken : controlToken;
      if (!expectedToken || request.headers["x-replaylock-token"] !== expectedToken) throw new Error("UNAUTHORIZED");
      if (request.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
      const payload = await readBody(request);
      if (ingestion) {
        if (payload.session !== session || !accepting) throw new Error("SESSION_NOT_ACTIVE");
        if (typeof payload.client !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(payload.client) || !Number.isSafeInteger(payload.sequence) || Number(payload.sequence) < 1) throw new Error("INVALID_ENVELOPE");
        const client = payload.client;
        const sequence = Number(payload.sequence);
        const write = (clientWrites.get(client) ?? Promise.resolve()).then(async () => {
        const last = acknowledged.get(client) ?? 0;
        if (sequence > last) {
          if (sequence !== last + 1) throw new Error("INCOMPLETE_OBSERVATION");
          if (payload.observation) {
            const observation = payload.observation as DevObservation;
            if (observation.environment !== "browser") throw new Error("INVALID_ENVIRONMENT");
            const profile = payload.profile as DevRuntimeProfile;
            if (!profile || profile.environment !== "browser" || [profile.runtime, profile.timezone, profile.locale].some(value => typeof value !== "string" || value.length > 512)) throw new Error("INVALID_PROFILE");
            let applied = appliedObservations.get(client);
            if (!applied || applied.sequence !== sequence) {
              applied = { sequence, persist: prepareObservation(observation, profile) };
              appliedObservations.set(client, applied);
            }
            await applied.persist();
          } else if (payload.counts) {
            const counts = parseDevCounts(payload.counts);
            for (const entry of counts) if (entry.metadata.environment !== "browser" || !knownMetadata.has(metadataKey(entry.metadata))) throw new Error("INCOMPLETE_OBSERVATION");
            if (appliedCounts.get(client) !== sequence) {
              report?.counts(counts);
              appliedCounts.set(client, sequence);
            }
            await checkpoint();
          } else if (payload.lifecycle === "ready") activeClients.add(client);
          else if (payload.lifecycle === "stopped") activeClients.delete(client);
          else {
            const block = payload.block as DevBlock;
            if (!block || typeof block.code !== "string" || !/^[A-Z_]{1,80}$/.test(block.code)) throw new Error("INVALID_ENVELOPE");
            const metadata = block.metadata === undefined ? undefined : parseDevMetadata(block.metadata);
            if (metadata && (metadata.environment !== "browser" || !knownMetadata.has(metadataKey(metadata)))) throw new Error("INCOMPLETE_OBSERVATION");
            recordBlock({ code: block.code, ...(metadata ? { metadata } : {}) });
          }
          acknowledged.set(client, sequence);
          appliedCounts.delete(client);
          appliedObservations.delete(client);
        }
        });
        clientWrites.set(client, write.catch(() => {}));
        await write;
        response.end(JSON.stringify({ sequence }));
      } else if (requestedPath === `${endpoint()}/start`) { await start(); response.end(JSON.stringify({ session })); }
      else if (requestedPath === `${endpoint()}/stop`) response.end(JSON.stringify(await stop()));
      else if (requestedPath === `${endpoint()}/status`) response.end(JSON.stringify({ root, recording, stopping, session, stored, blocks, completed, ...(report ? { report: report.snapshot(completed ? blocks ? "partial" : "complete" : "recording") } : {}) }));
      else throw new Error("NOT_FOUND");
    } catch (error) {
      const code = error instanceof Error ? error.message.split(/[:\s]/, 1)[0] : "SESSION_FAILURE";
      response.statusCode = code === "UNAUTHORIZED" ? 401 : 400;
      response.end(JSON.stringify({ code: /^[A-Z_]+$/.test(code ?? "") ? code : "SESSION_FAILURE" }));
    }
  }
  return {
    name: "replaylock:dev", enforce: "pre", apply: "serve",
    config() { return { optimizeDeps: { exclude: ["replaylock"] }, ssr: { external: ["replaylock"] } }; },
    async configResolved(config) { root = realpathSync(config.root); configuration = await loadDevConfiguration(root, config); project = createDevProjectCache(root, configuration.options); },
    async configureServer(vite) {
      server = vite;
      const metadataChange = (file: string): void => {
        if (!recording || file.includes(`${path.sep}.replaylock${path.sep}`)) return;
        const cacheDirectory = path.resolve(server!.config.cacheDir);
        if (file === cacheDirectory || file.startsWith(`${cacheDirectory}${path.sep}`)) return;
        const relative = path.relative(root, file);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return;
        project.invalidate();
        if (/(?:^|[/\\])(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(file)) invalidate();
      };
      server.watcher.on("add", metadataChange).on("change", metadataChange).on("unlink", metadataChange);
      server.middlewares.use((req, res, next) => { void middleware(req, res, next); });
      if (launch) await start();
      const middlewareMode = vite.config.server.middlewareMode;
      const host = vite.httpServer ?? (typeof middlewareMode === "object" ? middlewareMode.server : undefined);
      let closed = false;
      let publishing = Promise.resolve();
      let disposal: Promise<void> | undefined;
      const publish = async (): Promise<void> => {
        if (closed || manifestPath) return;
        const address = host?.address();
        if (!address || typeof address === "string") return;
        if (!["127.0.0.1", "::1", "0.0.0.0", "::", "::ffff:127.0.0.1"].includes(address.address)) throw new Error("LOCAL_ONLY: development listener must accept loopback connections");
        if ("setSecureContext" in host!) throw new Error("INSTRUMENTATION_UNSUPPORTED: development recording requires a local HTTP listener");
        const hostname = address.family === "IPv6" ? "[::1]" : "127.0.0.1";
        const url = `http://${hostname}:${address.port}${server!.config.base}`;
        manifestPath = path.join(root, ".replaylock", "dev", `server-${process.pid}-${randomUUID()}.json`);
        await atomicWrite(manifestPath, JSON.stringify({ root, url, token: controlToken, pid: process.pid, ...(launch ? { launch } : {}) } satisfies Manifest));
      };
      const listening = (): void => {
        publishing = publishing.then(publish).catch(() => { console.error("MANIFEST_WRITE_FAILED: could not publish development listener"); });
      };
      const closing = (): void => { void disposeHost().catch(() => { console.error("STORE_WRITE_FAILED: development listener cleanup failed"); }); };
      disposeHost = (): Promise<void> => disposal ??= (async () => {
        closed = true;
        host?.off("listening", listening); host?.off("close", closing);
        configureDevRuntime(undefined);
        if (checkpointTimer) clearTimeout(checkpointTimer);
        vite.watcher.off("add", metadataChange).off("change", metadataChange).off("unlink", metadataChange);
        await publishing;
        await pendingWrites;
        if (manifestPath) await rm(manifestPath, { force: true });
      })();
      host?.once("listening", listening);
      host?.once("close", closing);
      if (host?.listening) { publishing = publish(); await publishing; }
    },
    async closeBundle() { await disposeHost(); },
    resolveId(id) { return id === virtualRuntime ? `\0${virtualRuntime}` : null; },
    load(id) {
      if (id !== `\0${virtualRuntime}`) return null;
      if (!recording) return `export * from ${JSON.stringify(filesystemUrl(runtimePath))};`;
      const configImport = configuration.adapters.length && configuration.configurationPath
        ? `import configuration from ${JSON.stringify(filesystemUrl(configuration.configurationPath))};\n` : "const configuration = {valueAdapters:[]};\n";
      return `${configImport}import {startDevClient} from ${JSON.stringify(filesystemUrl(clientPath))};\nstartDevClient({session:${JSON.stringify(session)},token:${JSON.stringify(sessionToken)},endpoint:${JSON.stringify(`${endpoint()}/observations`)},adapters:configuration.valueAdapters});\nexport * from ${JSON.stringify(filesystemUrl(runtimePath))};\n`;
    },
    transformIndexHtml() {
      return recording ? [{ tag: "script", attrs: { type: "module" }, children: `import ${JSON.stringify(`/@id/__x00__${virtualRuntime}`)};`, injectTo: "head-prepend" as const }] : [];
    },
    transform(code, rawId, transformOptions) {
      if (!recording) return null;
      const id = rawId.split("?", 1)[0]!;
      if (id.startsWith("\0") || id.includes("/node_modules/") || !/\.[cm]?[jt]sx?$/.test(id)) return null;
      if (root !== packageRoot && (id === packageRoot || id.startsWith(`${packageRoot}/`))) return null;
      const environment = transformOptions?.ssr || this.environment?.name === "ssr" ? "node" : "browser";
      // Only authored, source-qualified modules are capture candidates. Other
      // plugins' generated overlays must not trigger whole-project analysis for
      // excluded modules or introduce new recording targets behind discovery.
      if (!project.hasAuthoredTargets(id, environment)) return null;
      const currentGeneration = String(generation).padStart(10, "0");
      const result = project.transform({ root, id, code, environment, generation: currentGeneration, options: configuration.options, runtimeImport: environment === "browser" ? virtualRuntime : "replaylock/dev/runtime" });
      report?.discover(result, environment, currentGeneration);
      for (const target of result.targets) knownMetadata.add(metadataKey({ locator: target.locator, environment, generation: currentGeneration, sourceGraphDigest: result.sourceGraphDigest }));
      return { code: result.code, map: result.map as null };
    },
    async handleHotUpdate(context) {
      if (context.file.includes("/.replaylock/")) return [];
      const relative = path.relative(root, context.file);
      if (recording && !relative.startsWith("..") && !path.isAbsolute(relative) && !context.file.startsWith(`${server!.config.cacheDir}/`) && !context.file.includes("/node_modules/") && /\.[cm]?[jt]sx?$/.test(context.file)) {
        invalidate();
        configuration = await loadDevConfiguration(root, server!.config);
        project = createDevProjectCache(root, configuration.options);
        for (const environment of ["node", "browser"] as const) report?.discover(project.analyze(environment), environment, String(generation).padStart(10, "0"));
        await configureNode();
        return [];
      }
    },
  };
}

function isLoopback(address: string): boolean { return ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(address); }
function isLocalHost(host: string): boolean {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${host}`).hostname); } catch { return false; }
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += part.length;
    if (size > 1024 * 1024) throw new Error("OVERSIZED_OBSERVATION"); parts.push(part);
  }
  const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_ENVELOPE");
  return value as Record<string, unknown>;
}
async function readStored(directory: string): Promise<StoredObservation[]> {
  const observations: StoredObservation[] = [];
  for (const name of (await readdir(directory)).filter(name => /^\d+\.json$/.test(name)).sort()) {
    const entry = JSON.parse(await readFile(path.join(directory, name), "utf8")) as StoredObservation;
    observations.push(entry);
  }
  return observations;
}
export async function hasDevelopmentPlugin(root: string): Promise<boolean> {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, undefined, root, "silent");
  if (!loaded) return false;
  async function contains(plugins: unknown): Promise<boolean> {
    const resolved = await plugins;
    if (Array.isArray(resolved)) { for (const plugin of resolved) if (await contains(plugin)) return true; }
    else if (resolved && typeof resolved === "object" && "name" in resolved && resolved.name === "replaylock:dev") return true;
    return false;
  }
  return contains(loaded.config.plugins);
}
export async function recordDevelopment(root: string, args: string[]): Promise<number> {
  if (args[0] === "--recover") return recoverDevelopment(root, args[1]);
  const separator = args.indexOf("--");
  const controlArgs = separator >= 0 ? args.slice(0, separator) : args;
  const attach = controlArgs.indexOf("--attach");
  const command = separator >= 0 ? args.slice(separator + 1) : [];
  const url = attach >= 0 ? controlArgs[attach + 1] : undefined;
  if (attach >= 0 && (!url || command.length)) throw new Error("Usage: replaylock record --attach <local Vite URL>");
  if (url && (!isLocalHost(new URL(url).host) || new URL(url).protocol !== "http:")) throw new Error("LOCAL_ONLY: attach requires a local HTTP Vite URL");
  if (!url && !command.length) throw new Error("Usage: replaylock record -- npm run dev");
  const launch = randomUUID();
  let child: ChildProcess | undefined, childStatus: number | undefined, childError: Error | undefined;
  let signaled = false;
  const stopSignal = () => { signaled = true; };
  process.on("SIGINT", stopSignal); process.on("SIGTERM", stopSignal);
  try {
    if (!url) {
      const executable = process.platform === "win32" && /^npm(?:\.cmd)?$/i.test(command[0]!) ? process.execPath : command[0]!;
      const childArgs = executable !== command[0] ? [process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...command.slice(1)] : command.slice(1);
      child = spawn(executable, childArgs, { cwd: root, stdio: "inherit", detached: process.platform !== "win32", env: { ...process.env, REPLAYLOCK_DEV_START: launch } });
      child.once("exit", (code, signal) => { childStatus = signal ? 2 : code ?? 2; });
      child.once("error", error => { childError = error; });
    }
    let manifest: Manifest | undefined;
    const deadline = Date.now() + (url ? 1000 : 30000);
    while (!manifest && Date.now() < deadline && childStatus === undefined && !childError && !signaled) {
      manifest = await findManifest(root, url, launch);
      if (!manifest) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!manifest) {
      if (childError) throw childError;
      if (childStatus !== undefined) return childStatus || 2;
      throw new Error("PLUGIN_NOT_ACTIVE: no active local ReplayLock dev plugin was found");
    }
    async function control(operation: string): Promise<Record<string, unknown>> {
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetch(`${manifest!.url}${prefix}/${operation}`, { method: "POST",
            headers: { "Content-Type": "application/json", "X-ReplayLock-Token": manifest!.token }, body: "{}", signal: AbortSignal.timeout(20000) });
          break;
        } catch (error) {
          const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
          const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
          // Status is read-only. A stale keep-alive connection must not make the
          // controller terminate an otherwise healthy application.
          if (operation !== "status" || attempt >= 2 || typeof code !== "string" || !["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code)) throw error;
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(result.code ?? "SESSION_FAILURE"));
      return result;
    }
    if (url) await control("start");
    console.log(`ReplayLock attached to ${manifest.url}; press Ctrl-C to stop recording`);
    let externallyStopped: Record<string, unknown> | undefined;
    let nextStatus = Date.now() + 1000;
    while (!signaled && childStatus === undefined && !externallyStopped) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!signaled && childStatus === undefined && Date.now() >= nextStatus) {
        nextStatus = Date.now() + 1000;
        const status = await control("status");
        if (status.completed && typeof status.completed === "object") externallyStopped = status.completed as Record<string, unknown>;
      }
    }
    if (childStatus === undefined) {
      const result = externallyStopped ?? await control("stop");
      console.log(`Recorded ${result.observations} observation(s); ${result.candidates} pending candidate(s)`);
      return Number(result.recordingBlocks ?? 0) > 0 ? 2 : 0;
    }
    console.error("SESSION_PARTIAL: development server exited before recording was stopped");
    return childStatus || 2;
  } finally {
    process.off("SIGINT", stopSignal); process.off("SIGTERM", stopSignal);
    if (child && childStatus === undefined && child.pid) {
      if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
      else child.kill("SIGTERM");
    }
  }
}
async function findManifest(root: string, url: string | undefined, launch: string): Promise<Manifest | undefined> {
  const directory = path.join(root, ".replaylock", "dev");
  let names: string[]; try { names = await readdir(directory); } catch { return undefined; }
  for (const name of names.filter(name => name.endsWith(".json"))) {
    try {
      const value = JSON.parse(await readFile(path.join(directory, name), "utf8")) as Manifest;
      if (value.root !== realpathSync(root) || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)) continue;
      const recorded = new URL(value.url);
      if (recorded.protocol !== "http:" || !isLocalHost(recorded.host)) continue;
      if (url ? recorded.port !== new URL(url).port || recorded.pathname !== new URL(url).pathname : value.launch !== launch) continue;
      process.kill(value.pid, 0); return value;
    } catch { continue; }
  }
  return undefined;
}

/** Recover only sealed observations; never invent completions from interrupted calls. */
export async function recoverDevelopment(root: string, id: string | undefined): Promise<number> {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Usage: replaylock record --recover <session-id>");
  const directory = path.join(root, ".replaylock", "observations", "dev-sessions", id);
  const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as { lockfileDigest: string; profiles: Record<"node" | "browser", DevRuntimeProfile>; pid?: number; retention?: false | DevRetentionPolicy };
  if (metadata.pid) {
    let alive = false;
    try { process.kill(metadata.pid, 0); alive = true; } catch {}
    if (alive) throw new Error("SESSION_MAY_BE_ACTIVE: stop the owning development server before recovery");
  }
  try { await readFile(path.join(directory, "result.json")); throw new Error("SESSION_ALREADY_RECOVERED"); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const entries = await readStored(directory);
  const observations = entries.map(entry => entry.observation);
  let retentionState: DevRetentionSnapshot | undefined;
  if (metadata.retention !== undefined) {
    let snapshot: DevRetentionSnapshot | undefined;
    try { snapshot = JSON.parse(await readFile(path.join(directory, "admission.json"), "utf8")) as DevRetentionSnapshot; }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const retention = await loadDevRetention(root, metadata.retention, { ...(snapshot ? { snapshot } : {}),
      admitted: entries.map(entry => createDevCandidate(entry.observation, metadata.lockfileDigest, entry.profile, "partial")) });
    retentionState = retention.snapshot();
  }
  const result = await persistDevObservations(root, observations, metadata.lockfileDigest, metadata.profiles, {
    captureStatus: "partial", observationProfiles: entries.map(entry => entry.profile), completedGenerations: [...new Set(observations.map(observation => observation.generation))].sort(),
    ...(retentionState ? { retentionState, retentionSealed: true } : {}),
  });
  let initial;
  try { initial = await readDevSessionReport(root, id); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const report = createDevSessionReport(id, initial);
  report.recover(entries.map(entry => ({ metadata: entry.observation, caseId: createDevCandidate(entry.observation, metadata.lockfileDigest, entry.profile).caseId })));
  report.block({ code: "SESSION_PARTIAL" });
  for (const block of result.blocks) report.block(block);
  if (retentionState) await atomicWrite(path.join(directory, "admission.json"), JSON.stringify(retentionState));
  await atomicWrite(path.join(directory, "report.json"), JSON.stringify(report.snapshot("partial")));
  await atomicWrite(path.join(directory, "result.json"), JSON.stringify({ ...result, session: id, captureStatus: "partial" }));
  console.log(`SESSION_PARTIAL: recovered ${observations.length} completed observation(s); ${result.candidates} pending candidate(s)`);
  return result.blocked ? 2 : 0;
}
