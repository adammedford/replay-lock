import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 34 acceptance suite verified");
} else if (scenario === "tolerance") {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "test/acceptance/tolerance-comparison.test.mjs"]);
  console.log("numeric tolerance comparison mode verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("numeric tolerance comparison documentation verified");
} else {
  throw new Error(`unknown issue 34 verification scenario: ${scenario}`);
}

async function verifyDocs() {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /Comparison modes/, "README must document comparison modes");
  // The whole-completion epsilon this issue shipped was superseded: one epsilon
  // applied to every number leaf, so an epsilon sized for a large field silently
  // admitted real changes in small siblings. Tolerance now names each leaf.
  assert.match(readme, /kind: "tolerance", leaves: \[\{ path, epsilon \}\]/, "README must show the per-leaf tolerance shape");
  assert.match(readme, /never applies to anything the reviewer did not name/, "README must state that tolerance cannot leak to an unnamed leaf");
  assert.match(readme, /need no migration/, "README must state the no-migration decision for exact cases");
  assert.match(readme, /migrated automatically when the completion has exactly one number leaf/, "README must state when the superseded form still migrates");
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
