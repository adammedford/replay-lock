import path from "node:path";

export function parseVerificationOptions(arguments_) {
  const parsed = { concurrency: "2", reporter: "dot", junit: undefined };
  const seen = new Set();
  for (const argument of arguments_) {
    const separator = argument.indexOf("=");
    const name = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    const valid = separator !== -1 && !seen.has(name) && (
      (name === "--concurrency" && ["1", "2"].includes(value)) ||
      (name === "--reporter" && ["dot", "spec"].includes(value)) ||
      (name === "--junit" && path.isAbsolute(value) && !value.includes("\0"))
    );
    if (!valid) {
      console.error(`Invalid verification option: ${argument}`);
      console.error("Usage: node scripts/run-verification.mjs [--concurrency=1|2] [--reporter=dot|spec] [--junit=<absolute-path>]");
      process.exit(2);
    }
    seen.add(name);
    parsed[name.slice(2)] = value;
  }
  return parsed;
}
