import { takeCoverage } from "node:v8";
import { parentPort, threadId } from "node:worker_threads";
import { Session } from "node:inspector";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Coverage-only observation: Vite executes transformed source under the same
// URL as native Node code. Preserve the actual code/map by V8 script identity.
if (process.env.NODE_V8_COVERAGE) {
  const inspector = new Session();
  const sources = {};
  inspector.connect();
  inspector.on("Debugger.scriptParsed", ({ params }) => {
    if (!(params.url.startsWith("file://") || path.isAbsolute(params.url))
      || !/[/\\](?:src|dist)[/\\]/.test(params.url) || /[/\\]node_modules[/\\]/.test(params.url)) return;
    inspector.post("Debugger.getScriptSource", { scriptId: params.scriptId }, (error, result) => {
      if (error) throw error;
      sources[params.scriptId] = { url: params.url, source: result.scriptSource, sourceMapURL: params.sourceMapURL };
    });
  });
  inspector.post("Debugger.enable");
  const snapshot = () => writeFileSync(path.join(process.env.NODE_V8_COVERAGE, `sources-${process.pid}-${threadId}.json`), JSON.stringify(sources));
  process.on("exit", snapshot);
  // Vitest terminates workers after their stop acknowledgement, bypassing the
  // normal-exit flush. Snapshot after teardown but before that termination.
  // No incoming listener, signal/exit patch, or altered completion semantics.
  if (/[/\\]vitest[/\\]dist[/\\]workers[/\\](?:forks|threads)\.js$/.test(process.argv[1] ?? "")) {
    const channel = parentPort ?? process;
    const method = parentPort ? "postMessage" : "send";
    const original = channel[method];
    channel[method] = function (...arguments_) {
      const message = arguments_[0];
      if (message?.__vitest_worker_response__ === true && message.type === "stopped") {
        snapshot();
        takeCoverage();
      }
      return Reflect.apply(original, this, arguments_);
    };
  }
}
