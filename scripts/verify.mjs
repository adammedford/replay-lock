import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerificationOptions } from "./verification-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = process.argv.slice(2);
// Validate before the tooling tests: those tests perform real fixture builds.
parseVerificationOptions(options);

// Keep the runner's own regression tests outside the runner to avoid recursion.
for (const command of [
  ["--test", "test/coverage/integrity.test.mjs", "test/coverage/remapping.test.mjs"],
  ["--test", "test/verification/runner.test.mjs"],
  ["scripts/run-verification.mjs", ...options],
]) {
  const result = spawnSync(process.execPath, command, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
