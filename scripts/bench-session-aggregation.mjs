import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { aggregateSession } from "../dist/session.js";

const token = "a".repeat(64);

async function setupBenchmarkSession() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replaylock-bench-session-"));
  const failuresDirectory = path.join(directory, "failures");
  await mkdir(failuresDirectory, { recursive: true });

  // Create 50 failure markers
  for (let i = 0; i < 50; i++) {
    await writeFile(
      path.join(failuresDirectory, `${i}-failure.json`),
      JSON.stringify({ code: "SESSION_PARTIAL", reason: "STORAGE_FAILURE" }),
    );
  }

  // Create 10 workers with 20 chunks each
  const workersDirectory = path.join(directory, "workers");
  for (let w = 0; w < 10; w++) {
    const workerId = `worker-${w}`;
    const workerDirectory = path.join(workersDirectory, workerId);
    const chunksDirectory = path.join(workerDirectory, "chunks");
    await mkdir(chunksDirectory, { recursive: true });

    await writeFile(
      path.join(workerDirectory, "registered.json"),
      JSON.stringify({ token, workerId, pid: 1234 }),
    );

    for (let c = 0; c < 20; c++) {
      const chunk = {
        token,
        workerId,
        sequence: c,
        record: {
          locator: { module: "src/math.ts", exportName: "add" },
          arguments: [c, c + 1],
          completion: { kind: "return", value: c * 2 + 1 },
        },
      };
      await writeFile(
        path.join(chunksDirectory, `${String(c).padStart(12, "0")}-chunk.complete.json`),
        JSON.stringify(chunk),
      );
    }

    await writeFile(
      path.join(workerDirectory, "closed.json"),
      JSON.stringify({ token, workerId, completedChunks: 20 }),
    );
  }

  return directory;
}

async function main() {
  const directory = await setupBenchmarkSession();
  try {
    // Warmup
    for (let i = 0; i < 5; i++) {
      await aggregateSession(directory, token, (v) => v);
    }

    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await aggregateSession(directory, token, (v) => v);
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    console.log(`Aggregation Benchmark Baseline:`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total time: ${totalMs.toFixed(2)} ms`);
    console.log(`  Average per aggregation: ${avgMs.toFixed(3)} ms`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
