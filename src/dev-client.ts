import { configureDevRuntime, flushDevRuntime, runtimeProfile } from "./dev-runtime.js";
import type { DevActivity, DevAdapter, DevBlock, DevMetadata, DevObservation } from "./dev-contract.js";
import { assertDevSafe, validateDevValue } from "./dev-values.js";

interface ClientSettings { session: string; token: string; endpoint: string; adapters?: readonly DevAdapter[] }
interface Counts { metadata: DevMetadata; invoked: number; completed: number }
interface Envelope { client: string; sequence: number; observation?: DevObservation; block?: DevBlock; counts?: Counts[]; lifecycle?: "ready" | "stopped" }
const clientKey = Symbol.for("replaylock.dev.client");

function metadata(value: DevMetadata): DevMetadata {
  if (!value || Object.keys(value).sort().join() !== "environment,generation,locator,sourceGraphDigest"
    || !value.locator || Object.keys(value.locator).sort().join() !== "kind,module,namePath") throw new Error("INVALID_ENVELOPE");
  assertDevSafe(value);
  return value;
}

/** Complete envelopes retain their identity across transport retries. */
export function startDevClient(settings: ClientSettings): void {
  const shared = globalThis as unknown as Record<symbol, string>;
  if (shared[clientKey] === settings.session) return;
  shared[clientKey] = settings.session;
  const client = crypto.randomUUID();
  const profile = runtimeProfile("browser");
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const queue = new Map<string, Envelope>();
  const storageKey = `replaylock.dev.queue:${settings.session}`;
  const identity = (entry: Envelope): string => `${entry.client}:${entry.sequence}`;
  let restoreFailed = false;
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(entries) && entries.length <= 1024) for (const entry of entries) {
      if (!entry || typeof entry.client !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.client) || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1) continue;
      if (new TextEncoder().encode(JSON.stringify(entry)).length > 256 * 1024) continue;
      try {
        if (entry.observation) {
          const observation = entry.observation;
          if (Object.keys(observation).some(key => !["locator", "environment", "generation", "sourceGraphDigest", "arguments", "trace", "completion"].includes(key))) throw new Error();
          assertDevSafe({ locator: observation.locator, environment: observation.environment, generation: observation.generation, sourceGraphDigest: observation.sourceGraphDigest });
          validateDevValue(entry.observation.arguments);
          validateDevValue(entry.observation.completion.value);
          if (!["return", "throw"].includes(observation.completion.kind) || Object.keys(observation.completion).some(key => !["kind", "value"].includes(key))) throw new Error();
          for (const event of entry.observation.trace) {
            if (!["call", "return", "throw"].includes(event.kind) || Object.keys(event).some(key => !(event.kind === "call" ? ["kind", "id", "operation", "arguments"] : ["kind", "id", "value"]).includes(key))) throw new Error();
            assertDevSafe({ id: event.id, operation: event.operation });
            validateDevValue(event.kind === "call" ? event.arguments : event.value);
          }
        } else if (entry.counts) {
          if (!Array.isArray(entry.counts) || entry.counts.length > 128) throw new Error();
          for (const count of entry.counts) {
            if (!count || !Number.isSafeInteger(count.invoked) || count.invoked < 0 || !Number.isSafeInteger(count.completed) || count.completed < 0 || !count.metadata) throw new Error();
            if (Object.keys(count).sort().join() !== "completed,invoked,metadata") throw new Error();
            metadata(count.metadata);
          }
        } else if (entry.lifecycle) {
          if (entry.lifecycle !== "ready" && entry.lifecycle !== "stopped") throw new Error();
        } else {
          if (!entry.block || !/^[A-Z_]{1,80}$/.test(entry.block.code)) throw new Error();
          if (entry.block.metadata) metadata(entry.block.metadata);
        }
        const restored: Envelope = { client: entry.client, sequence: entry.sequence,
          ...(entry.observation ? { observation: entry.observation } : entry.counts ? { counts: entry.counts } : entry.lifecycle ? { lifecycle: entry.lifecycle } : { block: { code: entry.block.code, ...(entry.block.metadata ? { metadata: entry.block.metadata } : {}) } }) };
        queue.set(identity(restored), restored);
      } catch { restoreFailed = true; }
    }
  } catch { /* Storage may be unavailable; the in-memory queue still works. */ }
  let sequence = 0;
  let sending: Promise<void> | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let limitReported = false;
  let dropped = false;
  const counts = new Map<string, Counts>();
  let countsScheduled = false;
  function flushCounts(): void {
    countsScheduled = false;
    const entries = [...counts.values()];
    counts.clear();
    for (let index = 0; index < entries.length; index += 128) enqueue({ counts: entries.slice(index, index + 128) });
  }
  function activity(event: DevActivity): void {
    const key = JSON.stringify(event.metadata);
    const entry = counts.get(key);
    if (!entry && counts.size >= 1000) { enqueue({ block: { code: "PENDING_LIMIT" } }); return; }
    const value = entry ?? { metadata: event.metadata, invoked: 0, completed: 0 };
    value[event.kind]++;
    counts.set(key, value);
    if (!countsScheduled) { countsScheduled = true; queueMicrotask(flushCounts); }
  }
  function persist(): void {
    try {
      if (queue.size) sessionStorage.setItem(storageKey, JSON.stringify([...queue.values()]));
      else sessionStorage.removeItem(storageKey);
    } catch { if (!limitReported) { limitReported = true; console.warn("ReplayLock PENDING_LIMIT: browser retry storage is unavailable"); } }
  }
  const hot = (import.meta as ImportMeta & { hot?: { on(name: string, handler: () => void): void } }).hot;
  function enqueue(envelope: Omit<Envelope, "sequence" | "client">): void {
    if (closed) return;
    if (queue.size >= 1000 && !envelope.lifecycle) {
      if (!dropped) { dropped = true; appendEnvelope({ block: { code: "PENDING_LIMIT" } }); }
      return;
    }
    appendEnvelope(envelope);
  }
  function appendEnvelope(envelope: Omit<Envelope, "sequence" | "client">): void {
    // Reserve bounded room for overflow diagnostics and reload/stop handshakes.
    if (queue.size >= 1024) return;
    const entry = { ...envelope, client, sequence: ++sequence };
    queue.set(identity(entry), entry);
    persist();
    void send();
  }
  function send(): Promise<void> {
    if (sending) return sending;
    if (!queue.size) return Promise.resolve();
    sending = (async () => {
      try {
        while (queue.size) {
          const envelope = queue.values().next().value!;
          const response = await nativeFetch(settings.endpoint, {
            method: "POST", headers: { "Content-Type": "application/json", "X-ReplayLock-Token": settings.token },
            body: JSON.stringify({ session: settings.session, profile, ...envelope }),
            signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) throw new Error("transport rejected");
          const ack = await response.json() as { sequence?: number };
          if (ack.sequence !== envelope.sequence) throw new Error("invalid acknowledgement");
          queue.delete(identity(envelope));
          persist();
        }
      } catch {
        if (!closed && retry === undefined) retry = setTimeout(() => { retry = undefined; void send(); }, 250);
      } finally { sending = undefined; }
    })();
    return sending;
  }
  configureDevRuntime({ adapters: settings.adapters ?? [], onObservation: observation => enqueue({ observation }), onBlock: block => enqueue({ block }), onActivity: activity });
  enqueue({ lifecycle: "ready" });
  if (restoreFailed) enqueue({ block: { code: "INCOMPLETE_OBSERVATION" } });
  hot?.on("vite:ws:connect", () => { void send(); });
  hot?.on("replaylock:stop", () => {
    void (async () => {
      await flushDevRuntime(4000);
      flushCounts();
      enqueue({ lifecycle: "stopped" });
      await send();
      configureDevRuntime(undefined);
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      if (queue.size) console.warn("ReplayLock INCOMPLETE_OBSERVATION: browser disconnected before acknowledgement");
    })();
  });
  globalThis.addEventListener("pagehide", () => {
    flushCounts();
    enqueue({ lifecycle: "stopped" });
    for (const envelope of queue.values()) {
      const body = JSON.stringify({ session: settings.session, profile, ...envelope });
      if (new TextEncoder().encode(body).byteLength > 60 * 1024) continue;
      void nativeFetch(settings.endpoint, { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "X-ReplayLock-Token": settings.token }, body }).catch(() => {});
    }
  });
}
