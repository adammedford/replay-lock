import { parentPort, workerData } from "node:worker_threads";
import { createDevProjectCache } from "./dev-transform.js";
import type { DevEnvironment, DevTransformOptions, ResolvedDevOptions } from "./dev-contract.js";

export interface AnalysisRequest {
  id: number;
  epoch: number;
  options: ResolvedDevOptions;
  transform?: DevTransformOptions;
}

// Each worker owns one realm's compiler state. Messages execute synchronously;
// no AST or mutable cache state crosses the worker boundary.
const { root, environment } = workerData as { root: string; environment: DevEnvironment };
let epoch = -1;
let project: ReturnType<typeof createDevProjectCache>;
parentPort!.on("message", (request: AnalysisRequest) => {
  try {
    if (epoch !== request.epoch) {
      project = createDevProjectCache(root, request.options);
      epoch = request.epoch;
    }
    const result = request.transform ? project.transformAuthored(request.transform) : project.analyze(environment);
    parentPort!.postMessage({ id: request.id, result });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : "INSTRUMENTATION_UNSUPPORTED" });
  }
});
