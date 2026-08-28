import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 36 acceptance suite verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("async trust boundary documentation verified");
} else {
  throw new Error(`unknown issue 36 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const troubleshooting = await readFile(path.join(root, "docs", "troubleshooting.md"), "utf8");
  const pilot = await readFile(path.join(root, "docs", "pilot-checklist.md"), "utf8");

  assert.match(
    readme,
    /synchronous or `async`, but never a generator or async generator/,
    "README must state the async capture boundary",
  );
  assert.match(
    troubleshooting,
    /`?await`? is transparent to the analyzer/,
    "troubleshooting guide must describe await transparency",
  );
  assert.match(
    troubleshooting,
    /Promise\.all|new Promise/,
    "troubleshooting guide must name the common Promise patterns that require an assumption",
  );
  assert.match(
    pilot,
    /synchronous or `async`/,
    "pilot checklist must state async targets are in scope",
  );
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
