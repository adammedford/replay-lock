import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function scriptPath(url) {
  if (url.startsWith("file://")) return path.resolve(fileURLToPath(url));
  return path.isAbsolute(url) ? path.resolve(url) : undefined;
}

// Keep process documents separate until these proofs have been established.
// Merging first would lose the distinction between acceptance tests and workers.
export async function childExecutionEvidence(root, rawDirectory) {
  const evidence = {};
  let documentCount = 0;
  const processes = new Set();
  for (const file of (await readdir(rawDirectory)).sort()) {
    const filename = /^coverage-(\d+)-\d+-(\d+)\.json$/.exec(file);
    if (!filename) continue;
    const bytes = await readFile(path.join(rawDirectory, file));
    const document = JSON.parse(bytes);
    assert.ok(Array.isArray(document.result), `invalid V8 coverage document: ${file}`);
    documentCount += 1;
    processes.add(Number(filename[1]));
    const scripts = document.result.map((script) => ({ ...script, file: scriptPath(script.url) }));
    const loaded = (relative) => scripts.some((script) => script.file === path.join(root, relative));
    const executed = (relative, name) => scripts.filter((script) => script.file === path.join(root, relative))
      .flatMap((script) => script.functions).find((fn) => fn.functionName === name && fn.ranges[0]?.count > 0);
    const acceptanceProcess = scripts.some((script) => script.file?.startsWith(path.join(root, "test", "acceptance") + path.sep));
    const record = (role, source, fn) => {
      if (!fn || acceptanceProcess || evidence[role]) return;
      evidence[role] = {
        document: file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        pid: Number(filename[1]),
        threadId: Number(filename[2]),
        source,
        function: fn.functionName,
        count: fn.ranges[0].count,
      };
    };
    record("CLI", "src/cli.ts", executed("dist/cli.js", "main"));
    if (loaded("node_modules/vitest/vitest.mjs") || loaded("node_modules/vitest/dist/cli.js")) {
      record("Vite transform", "src/vite-plugin.ts", executed("dist/vite-plugin.js", "instrumentTarget"));
    }
    if (["forks", "threads"].some((worker) => loaded(`node_modules/vitest/dist/workers/${worker}.js`))) {
      record("Vitest worker runtime", "src/runtime.ts", executed("dist/runtime.js", "observeCall"));
    }
  }
  for (const role of ["CLI", "Vite transform", "Vitest worker runtime"]) {
    assert.ok(evidence[role], `missing child execution: ${role}`);
  }
  assert.equal(new Set(Object.values(evidence).map((role) => `${role.pid}:${role.threadId}`)).size, 3, "CLI, Vite, and runtime evidence must come from distinct processes or worker threads");
  return { documentCount, processCount: processes.size, roles: evidence };
}
