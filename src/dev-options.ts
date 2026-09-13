import { createServer, loadConfigFromFile, type Alias, type ResolvedConfig } from "vite";
import { findProjectConfiguration } from "./project-configuration.js";
import type { DevAdapter, DevOptions, DevRetentionPolicy, ResolvedDevOptions } from "./dev-contract.js";

export function resolveDevRetention(input?: false | Partial<DevRetentionPolicy>): false | DevRetentionPolicy {
  if (input === false) return false;
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "maxPerCallable" && key !== "maxPerGroup"))) {
    throw new Error("INVALID_POLICY: capture.retention must be false or a retention limits object");
  }
  const maxPerCallable = input?.maxPerCallable ?? 20;
  const maxPerGroup = input?.maxPerGroup ?? 2;
  if (!Number.isSafeInteger(maxPerCallable) || !Number.isSafeInteger(maxPerGroup)
    || maxPerGroup < 1 || maxPerGroup > maxPerCallable || maxPerCallable > 1000) {
    throw new Error("INVALID_POLICY: retention limits must satisfy 1 <= maxPerGroup <= maxPerCallable <= 1000");
  }
  return { maxPerCallable, maxPerGroup };
}

export function resolveDevOptions(input: DevOptions = {}): ResolvedDevOptions {
  if (!input || typeof input !== "object") throw new Error("INVALID_POLICY: invalid development configuration");
  const capture = input.capture ?? {};
  const effects = input.effects ?? {};
  if (capture.mode !== undefined && capture.mode !== "automatic" && capture.mode !== "annotated") {
    throw new Error("INVALID_POLICY: capture.mode must be automatic or annotated");
  }
  function strings(value: unknown, fallback: string[]): string[] {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.length)) {
      throw new Error("INVALID_POLICY: capture paths and environment names must be arrays of nonempty strings");
    }
    return [...new Set(value as string[])];
  }
  function flag(value: unknown): boolean {
    if (value === undefined) return true;
    if (typeof value !== "boolean") throw new Error("INVALID_POLICY: effect switches must be boolean");
    return value;
  }
  return {
    capture: {
      mode: capture.mode ?? "automatic",
      include: strings(capture.include, ["**/*"]),
      exclude: strings(capture.exclude, ["**/node_modules/**", "**/.replaylock/**", "**/dist/**", "**/test/**", "**/tests/**", "**/*.test.*", "**/*.spec.*", "**/*.config.*"]),
      retention: resolveDevRetention(capture.retention),
    },
    effects: {
      randomness: flag(effects.randomness), time: flag(effects.time),
      fetch: flag(effects.fetch), filesystem: flag(effects.filesystem),
      environment: strings(effects.environment, []),
    },
  };
}

export function developmentAliases(aliases: readonly Alias[], resolved = false): { find: string; replacement: string }[] {
  const result: { find: string; replacement: string }[] = [];
  for (const alias of aliases) {
    const find = alias.find;
    if (resolved && find instanceof RegExp && [/^\/?@vite\/env/, /^\/?@vite\/client/].some(builtin => builtin.source === find.source)) continue;
    if (typeof alias.find !== "string" || alias.customResolver) throw new Error("INSTRUMENTATION_UNSUPPORTED: development analysis requires string aliases without custom resolvers");
    result.push({ find: alias.find, replacement: alias.replacement });
  }
  return result;
}

export async function loadDevConfiguration(root: string, resolvedVite?: Pick<ResolvedConfig, "resolve">): Promise<{
  options: ResolvedDevOptions; adapters: DevAdapter[]; configurationPath?: string;
}> {
  // Configuration hooks can acquire resources that plugins release through
  // buildEnd/closeBundle. Standalone callers must own that Vite lifecycle;
  // callers inside an existing server leave ownership with that server.
  if (!resolvedVite) {
    const server = await createServer({
      root, mode: "development", logLevel: "silent",
      server: { middlewareMode: true, watch: null, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try { return await loadDevConfiguration(root, server.config); }
    finally { await server.close(); }
  }
  const vite = resolvedVite;
  const resolveAliases = developmentAliases(vite.resolve.alias, true);
  const configurationPath = await findProjectConfiguration(root);
  if (!configurationPath) return { options: { ...resolveDevOptions(), resolveAliases }, adapters: [] };
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, configurationPath, root, "silent");
  if (!loaded) throw new Error("INVALID_POLICY: ReplayLock configuration could not be loaded");
  const config = loaded.config as DevOptions & { valueAdapters?: DevAdapter[] };
  if (config.valueAdapters !== undefined && !Array.isArray(config.valueAdapters)) throw new Error("VALUE_ADAPTER_INVALID");
  return { options: { ...resolveDevOptions(config), resolveAliases }, adapters: config.valueAdapters ?? [], configurationPath };
}
