import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [
  "--test",
  "--test-concurrency=1",
  "test/acceptance/adapter-integration.test.mjs",
], { cwd: root, encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
assert.equal(result.status, 0, "adapter integration test failed");
console.log("adapter branch integration verified");
