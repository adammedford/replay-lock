import { Worker } from "node:worker_threads";
import type { DevAnalysis, DevEnvironment, DevTransformOptions, DevTransformResult, ResolvedDevOptions } from "./dev-contract.js";
import type { AnalysisRequest } from "./dev-analysis-worker.js";

/** Session-owned, lazy workers keep realm analysis off the Vite event loop. */
export function createDevAnalysisClient(root: string, initialOptions: ResolvedDevOptions) {
  let options = initialOptions, epoch = 0, sequence = 0, closed = false;
  type Result = DevAnalysis | DevTransformResult | null;
  const workers = new Map<DevEnvironment, {
    worker: Worker;
    pending: Map<number, { resolve(value: Result): void; reject(error: Error): void }>;
    failure?: Error;
  }>();
  function request(environment: DevEnvironment, transform?: DevTransformOptions): Promise<Result> {
    if (closed) return Promise.reject(new Error("INSTRUMENTATION_UNSUPPORTED: analysis session is closed"));
    let state = workers.get(environment);
    if (!state) {
      const worker = new Worker(new URL("./dev-analysis-worker.js", import.meta.url), { workerData: { root, environment } });
      state = { worker, pending: new Map() };
      workers.set(environment, state);
      const own = state;
      const fail = (error: Error): void => {
        own.failure = error;
        for (const pending of own.pending.values()) pending.reject(error);
        own.pending.clear();
        worker.unref();
      };
      worker.on("error", fail);
      worker.on("exit", () => fail(new Error("INSTRUMENTATION_UNSUPPORTED: analysis worker exited")));
      worker.on("message", (message: { id: number; result?: Result; error?: string }) => {
        const pending = own.pending.get(message.id);
        if (!pending) return;
        own.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result!);
        if (!own.pending.size) worker.unref();
      });
    }
    if (state.failure) return Promise.reject(state.failure);
    const own = state;
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      own.pending.set(id, { resolve, reject });
      own.worker.ref();
      try { own.worker.postMessage({ id, epoch, options, ...(transform ? { transform } : {}) } satisfies AnalysisRequest); }
      catch (error) {
        own.pending.delete(id);
        if (!own.pending.size) own.worker.unref();
        reject(error);
      }
    });
  }
  return {
    analyze(environment: DevEnvironment) { return request(environment) as Promise<DevAnalysis>; },
    transformAuthored(input: DevTransformOptions) { return request(input.environment, input) as Promise<DevTransformResult | null>; },
    invalidate(): void { epoch++; },
    configure(next: ResolvedDevOptions): void { options = next; epoch++; },
    async close(): Promise<void> {
      closed = true;
      await Promise.all([...workers.values()].map(({ worker }) => worker.terminate()));
      workers.clear();
    },
  };
}
