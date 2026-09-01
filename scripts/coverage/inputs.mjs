import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export function reportOptions(arguments_) {
  const options = {};
  for (const argument of arguments_) {
    const match = /^--(root|reports|raw)=(.+)$/.exec(argument);
    assert.ok(match && path.isAbsolute(match[2]) && !options[match[1]], "expected unique absolute --root, --reports, and --raw paths");
    options[match[1]] = path.resolve(match[2]);
  }
  assert.ok(options.root && options.reports && options.raw, "expected --root, --reports, and --raw");
  options.root = realpathSync(options.root);
  return options;
}

export function trackedSources(root) {
  const files = spawnSync("git", ["ls-files", "-z", "--", "src"], { cwd: root, encoding: "utf8" });
  assert.ifError(files.error);
  assert.equal(files.status, 0, files.stderr);
  const tracked = files.stdout.split("\0").filter((file) => file.endsWith(".ts")).sort();
  assert.ok(tracked.length > 0, "no tracked TypeScript sources");
  return tracked;
}
