import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] ?? "all";

if (scenario === "all") {
  run(process.execPath, [path.join(root, "scripts", "run-verification.mjs")]);
  console.log("issue 21 acceptance suite verified");
} else if (scenario === "docs") {
  await verifyDocs();
  console.log("trusted package catalog documentation verified");
} else {
  const files = {
    validation: "test/acceptance/package-catalog-validation.test.mjs",
    integration: "test/acceptance/package-catalog-integration.test.mjs",
  };
  assert.ok(Object.hasOwn(files, scenario), `unknown issue 21 verification scenario: ${scenario}`);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
  run(process.execPath, ["--test", "--test-concurrency=1", files[scenario]]);
  console.log(`trusted package catalog ${scenario} verified`);
}

async function verifyDocs() {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const doc = await readFile(path.join(root, "docs", "trusted-packages.md"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  assert.match(readme, /## Trusted packages/, "README must document the trusted-package feature");
  assert.match(readme, /trustedPackages/, "README config example must show trustedPackages");
  for (const code of [
    "TRUSTED_PACKAGE_INVALID",
    "TRUSTED_PACKAGE_CONFIG_LOAD_FAILED",
    "TRUSTED_PACKAGE_REGISTRY_FAILED",
    "TRUSTED_PACKAGE_DEFINITION_INVALID",
    "TRUSTED_PACKAGE_ID_DUPLICATE",
    "TRUSTED_PACKAGE_VERSION_RANGE_INVALID",
    "TRUSTED_PACKAGE_CALL",
  ]) {
    assert.match(readme, new RegExp(code), `README stable diagnostics list must include ${code}`);
  }
  assert.match(readme, /docs\/trusted-packages\.md/, "README must link to the trusted-packages doc");

  assert.match(doc, /# Trusted Packages/);
  assert.match(doc, /one specific export of one specific package/i, "doc must describe the package+export scope");
  assert.match(doc, /bound to a semver range/i, "doc must describe the version scope");
  assert.match(doc, /npm-only|package-lock\.json/, "doc must describe the npm-only version-resolution limitation");
  assert.match(doc, /unpinned/, "doc must describe the unpinned escape hatch");

  assert.ok(packageJson.files.includes("docs/trusted-packages.md"), "package.json files must ship the new doc");
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed`);
}
