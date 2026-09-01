import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { childExecutionEvidence } from "./process-evidence.mjs";
import { reportOptions, trackedSources } from "./inputs.mjs";

try {
  const options = reportOptions(process.argv.slice(2));
  const tracked = trackedSources(options.root);
  const report = JSON.parse(await readFile(path.join(options.reports, "coverage-final.json"), "utf8"));
  for (const file of tracked) {
    assert.ok(report[path.join(options.root, file)], `missing tracked source: ${file}`);
  }
  const allowed = new Set(tracked.map((file) => path.join(options.root, file)));
  for (const [file, coverage] of Object.entries(report)) {
    assert.ok(allowed.has(file), `unexpected coverage source: ${file}`);
    assert.equal(coverage.path, file, "coverage key and source path disagree");
  }
  const children = await childExecutionEvidence(options.root, options.raw);
  for (const [role, witness] of Object.entries(children.roles)) {
    const mapped = report[path.join(options.root, witness.source)];
    const functionId = Object.keys(mapped.fnMap).find((id) => mapped.fnMap[id].name === witness.function && mapped.f[id] > 0);
    assert.ok(functionId !== undefined, `missing mapped child execution: ${role} (${witness.source})`);
    witness.mappedCount = mapped.f[functionId];
  }
  await writeFile(path.join(options.reports, "integrity.json"), JSON.stringify({
    trackedSources: tracked,
    ...children,
  }, null, 2) + "\n");
  console.log(`coverage integrity verified: ${tracked.length} tracked TypeScript sources, ${children.documentCount} V8 documents, CLI/Vite/Vitest child execution`);
} catch (error) {
  console.error(`Coverage integrity failed: ${error.message}`);
  process.exitCode = 1;
}
