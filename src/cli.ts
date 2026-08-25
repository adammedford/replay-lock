#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  artifactJson,
  atomicWrite,
  createCandidate,
  decodeArguments,
  isObject,
  parseCandidate,
  parseCase,
  toCaseArtifact,
  validateObservation,
  type CandidateArtifact,
  type CaseArtifact,
} from "./model.js";

const require = createRequire(import.meta.url);

async function main(arguments_: string[]): Promise<number> {
  const [command, ...rest] = arguments_;
  switch (command) {
    case "record":
      return record(rest);
    case "review":
      return review();
    case "verify":
      return verify();
    default:
      printUsage();
      return 2;
  }
}

async function record(arguments_: string[]): Promise<number> {
  const separator = arguments_.indexOf("--");
  const childArguments = separator >= 0 ? arguments_.slice(separator + 1) : [];
  const [childCommand, ...childRest] = childArguments;
  if (!childCommand) {
    console.error("Usage: replaylock record -- <vitest-backed command>");
    return 2;
  }

  const root = process.cwd();
  const lockfileDigest = await projectLockfileDigest(root);
  const sessionDirectory = path.join(
    root,
    ".replaylock",
    "observations",
    "sessions",
    randomUUID(),
  );
  const sessionToken = randomBytes(32).toString("hex");
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });

  const childStatus = await runChild(childCommand, childRest, {
    ...process.env,
    REPLAYLOCK_SESSION_DIR: sessionDirectory,
    REPLAYLOCK_SESSION_TOKEN: sessionToken,
  }, "inherit");
  if (childStatus !== 0) return childStatus;

  const handshake = await readJson(path.join(sessionDirectory, "handshake.json"));
  if (!isObject(handshake) || handshake.token !== sessionToken) {
    console.error("PLUGIN_NOT_ACTIVE: the configured Vite integration did not activate");
    return 2;
  }

  const observations = await readObservations(sessionDirectory, sessionToken);
  const pendingDirectory = path.join(root, ".replaylock", "observations", "pending");
  await mkdir(pendingDirectory, { recursive: true, mode: 0o700 });
  for (const observation of observations) {
    const candidate = createCandidate(observation, lockfileDigest);
    const candidatePath = path.join(pendingDirectory, `${candidate.caseId}.json`);
    await atomicWrite(candidatePath, artifactJson(candidate));
  }

  console.log(`Recorded ${observations.length} candidate(s)`);
  return 0;
}

async function review(): Promise<number> {
  const root = process.cwd();
  const pendingDirectory = path.join(root, ".replaylock", "observations", "pending");
  const pendingFiles = await jsonFiles(pendingDirectory);
  if (pendingFiles.length === 0) {
    console.log("No pending candidates");
    return 0;
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  const decisions = terminal[Symbol.asyncIterator]();
  try {
    for (const filename of pendingFiles) {
      const pendingPath = path.join(pendingDirectory, filename);
      const candidate = parseCandidate(await readFile(pendingPath, "utf8"));
      printCandidate(candidate);
      stdout.write("[a]ccept or [s]kip? ");
      const decision = await decisions.next();
      const answer = (decision.done ? "" : decision.value).trim().toLowerCase();
      if (answer !== "a" && answer !== "accept") {
        console.log(`Skipped ${candidate.caseId}`);
        continue;
      }

      const artifact = toCaseArtifact(candidate);
      const casePath = path.join(root, ".replaylock", "cases", `${artifact.caseId}.json`);
      await atomicWrite(casePath, artifactJson(artifact));
      await unlink(pendingPath);
      console.log(`Accepted ${artifact.caseId}`);
    }
  } finally {
    terminal.close();
  }
  return 0;
}

async function verify(): Promise<number> {
  const root = process.cwd();
  const caseDirectory = path.join(root, ".replaylock", "cases");
  const caseFiles = await jsonFiles(caseDirectory);
  if (caseFiles.length === 0) {
    console.log("No accepted cases");
    return 0;
  }

  const cases: CaseArtifact[] = [];
  for (const filename of caseFiles) {
    cases.push(parseCase(await readFile(path.join(caseDirectory, filename), "utf8")));
  }

  const verificationDirectory = path.join(root, ".replaylock", "verify", randomUUID());
  const harnessPath = path.join(verificationDirectory, "replaylock.verify.test.ts");
  const configPath = path.join(verificationDirectory, "vitest.config.mjs");
  await mkdir(verificationDirectory, { recursive: true, mode: 0o700 });
  await writeFile(harnessPath, verificationHarness(cases, root, verificationDirectory), {
    encoding: "utf8",
    mode: 0o600,
  });
  const harnessLocator = path.relative(root, harnessPath).replaceAll(path.sep, "/");
  await writeFile(
    configPath,
    `export default { root: ${JSON.stringify(root)}, test: { include: [${JSON.stringify(harnessLocator)}] } };\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    const vitestPackage = require.resolve("vitest/package.json");
    const vitestBinary = path.join(path.dirname(vitestPackage), "vitest.mjs");
    const environment = { ...process.env };
    delete environment.REPLAYLOCK_SESSION_DIR;
    delete environment.REPLAYLOCK_SESSION_TOKEN;
    const status = await runChild(
      process.execPath,
      [
        vitestBinary,
        "run",
        "--config",
        configPath,
        harnessLocator,
      ],
      environment,
      "inherit",
    );
    if (status !== 0) return 1;
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }

  console.log(`Verified ${cases.length} case(s)`);
  return 0;
}

async function readObservations(sessionDirectory: string, token: string) {
  const filenames = (await readdir(sessionDirectory)).filter((name) => name.endsWith(".jsonl")).sort();
  const observations = [];
  for (const filename of filenames) {
    const contents = await readFile(path.join(sessionDirectory, filename), "utf8");
    for (const line of contents.split("\n")) {
      if (line.length === 0) continue;
      const observation = validateObservation(JSON.parse(line) as unknown);
      if (observation.token === token) observations.push(observation);
    }
  }
  return observations;
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function printCandidate(candidate: CandidateArtifact): void {
  console.log(`Target: ${candidate.locator.module}#${candidate.locator.exportName}`);
  console.log(`Arguments: ${JSON.stringify(decodeArguments(candidate.arguments))}`);
  console.log(`Return: ${JSON.stringify(candidate.completion.value.value)}`);
  console.log(`Occurrences: ${candidate.occurrences}`);
  console.log(
    `Eligibility: ${candidate.eligibility.verdict} (${candidate.eligibility.reasonCodes.join(", ")})`,
  );
  console.log(`Source graph: ${candidate.provenance.sourceGraphDigest}`);
  console.log(`Lockfile: ${candidate.provenance.lockfileDigest}`);
  console.log(`Runtime: ${JSON.stringify(candidate.provenance.runtimeProfile)}`);
}

function verificationHarness(cases: CaseArtifact[], root: string, harnessDirectory: string): string {
  const imports = cases.map(
    (artifact, index) => {
      let moduleSpecifier = path
        .relative(harnessDirectory, path.join(root, artifact.locator.module))
        .replaceAll(path.sep, "/");
      if (!moduleSpecifier.startsWith(".")) moduleSpecifier = `./${moduleSpecifier}`;
      return `import * as target${index} from ${JSON.stringify(moduleSpecifier)};`;
    },
  );
  const tests = cases.map((artifact, index) => {
    const expected = JSON.stringify(artifact.completion.value.value);
    const arguments_ = JSON.stringify(decodeArguments(artifact.arguments));
    const exportName = JSON.stringify(artifact.locator.exportName);
    return `test(${JSON.stringify(`ReplayLock ${artifact.caseId}`)}, () => {
  const actual = target${index}[${exportName}](...${arguments_});
  if (typeof actual !== "number" || !Number.isFinite(actual) || Object.is(actual, -0) || !Object.is(actual, ${expected})) {
    throw new Error(${JSON.stringify(`OUTPUT_MISMATCH ${artifact.locator.module}#${artifact.locator.exportName}: expected ${expected}, received `)} + String(actual));
  }
});`;
  });
  return [`import { test } from "vitest";`, ...imports, "", ...tests, ""].join("\n");
}

async function projectLockfileDigest(root: string): Promise<string> {
  const supportedLockfiles = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ];
  const found: Array<{ name: string; bytes: Buffer }> = [];
  for (const name of supportedLockfiles) {
    try {
      found.push({ name, bytes: await readFile(path.join(root, name)) });
    } catch (error) {
      if (isObject(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  if (found.length !== 1) {
    const detail = found.length === 0 ? "none found" : found.map(({ name }) => name).join(", ");
    throw new Error(`ReplayLock requires exactly one supported project lockfile (${detail})`);
  }
  const lockfile = found[0];
  if (!lockfile) throw new Error("ReplayLock could not read the project lockfile");
  return `sha256:${createHash("sha256").update(lockfile.bytes).digest("hex")}`;
}

function runChild(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  stdio: "inherit",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      stdio,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Wrapped command terminated by ${signal}`);
        resolve(2);
      } else {
        resolve(code ?? 2);
      }
    });
  });
}

function printUsage(): void {
  console.error("Usage: replaylock <record|review|verify>");
}

main(process.argv.slice(2)).then(
  (status) => {
    process.exitCode = status;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  },
);
