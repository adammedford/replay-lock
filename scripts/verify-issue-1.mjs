import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

for (let issue = 2; issue <= 20; issue += 1) {
  await access(path.join(root, "scripts", `verify-issue-${issue}.mjs`));
}
for (const integration of ["analysis", "recording", "workflow", "adapter"]) {
  await access(path.join(root, "scripts", `verify-${integration}-integration.mjs`));
}
for (const documentation of [
  "README.md",
  "docs/value-adapters.md",
  "docs/troubleshooting.md",
  "docs/pilot-checklist.md",
]) {
  await access(path.join(root, documentation));
  assert.ok(packageJson.files.includes(documentation), `${documentation} must ship in the package`);
}

const readme = await readFile(path.join(root, "README.md"), "utf8");
for (const contract of [
  "Record, review, verify",
  "REPLAY_SAFETY_REGRESSION",
  "STORE_WRITE_FAILED",
  "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED",
  "VALUE_ADAPTER_MISSING",
  "VALUE_ADAPTER_VERSION_MISMATCH",
]) assert.match(readme, new RegExp(contract), `README must retain parent contract ${contract}`);

const diffCheck = spawnSync("git", ["diff", "--check"], { cwd: root, encoding: "utf8" });
assert.equal(diffCheck.status, 0, `${diffCheck.stdout}${diffCheck.stderr}`);

console.log("issue 1 root contract verified");
