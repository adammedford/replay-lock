import { performance } from "node:perf_hooks";
import { diffDevValues } from "../dist/dev-diff.js";

// Helper to create a record DevValue structure
function createRecord(size, valuePrefix = "val") {
  const entries = [];
  for (let i = 0; i < size; i++) {
    entries.push({
      key: `field_${i.toString().padStart(6, "0")}`,
      value: { kind: "string", value: `${valuePrefix}_${i}` }
    });
  }
  return { kind: "record", entries };
}

function runBenchmark(name, expected, actual, iterations) {
  // Warmup
  for (let i = 0; i < 50; i++) {
    diffDevValues(expected, actual);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    diffDevValues(expected, actual);
  }
  const elapsedMs = performance.now() - start;
  const opsPerSec = (iterations / elapsedMs) * 1000;
  console.log(`${name}: ${elapsedMs.toFixed(2)} ms for ${iterations} ops (${opsPerSec.toFixed(0)} ops/sec)`);
  return { elapsedMs, opsPerSec };
}

console.log("=== dev-diff Benchmark ===");

const smallExpected = createRecord(10, "a");
const smallActual = createRecord(10, "a");
runBenchmark("Small Record (10 keys) - Equal", smallExpected, smallActual, 20000);

const mediumExpected = createRecord(100, "a");
const mediumActual = createRecord(100, "a");
runBenchmark("Medium Record (100 keys) - Equal", mediumExpected, mediumActual, 5000);

const largeExpected = createRecord(1000, "a");
const largeActual = createRecord(1000, "a");
runBenchmark("Large Record (1000 keys) - Equal", largeExpected, largeActual, 500);

const diffExpected = createRecord(100, "a");
const diffActual = createRecord(100, "b");
runBenchmark("Medium Record (100 keys) - Different at end", diffExpected, diffActual, 5000);
