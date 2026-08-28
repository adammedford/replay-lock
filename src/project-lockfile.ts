import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_PROJECT_LOCKFILES = Object.freeze([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const);

export interface ProjectLockfile {
  name: (typeof SUPPORTED_PROJECT_LOCKFILES)[number];
  bytes: Uint8Array;
}

export interface SelectProjectLockfileOptions {
  projectRoot?: string;
  lockfilePath?: string;
  lockfileBytes?: Uint8Array | string;
  lockfileName?: string;
}

export function selectProjectLockfile(options: SelectProjectLockfileOptions): ProjectLockfile {
  if (options.lockfileBytes !== undefined) {
    if (!options.lockfileName) throw new Error("lockfileName is required with lockfileBytes");
    const name = requireSupportedLockfileName(options.lockfileName);
    return { name, bytes: toBytes(options.lockfileBytes) };
  }

  const root = options.projectRoot ? path.resolve(options.projectRoot) : undefined;
  const explicit = options.lockfilePath ? path.resolve(options.lockfilePath) : undefined;
  if (explicit) {
    if (!root) throw new Error("projectRoot is required with lockfilePath");
    if (path.dirname(explicit) !== root) throw new Error("lockfile must be at the project root");
    const name = requireSupportedLockfileName(path.basename(explicit));
    return { name, bytes: readFileSync(explicit) };
  }
  if (!root) throw new Error("projectRoot or complete lockfile bytes are required");

  const entries = readdirSync(root, { withFileTypes: true });
  const names = supportedNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  requireExactlyOneLockfile(names);
  const name = names[0]!;
  return { name, bytes: readFileSync(path.join(root, name)) };
}

export async function readProjectLockfile(projectRoot: string): Promise<ProjectLockfile> {
  const root = path.resolve(projectRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const names = supportedNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  requireExactlyOneLockfile(names);
  const name = names[0]!;
  return { name, bytes: await readFile(path.join(root, name)) };
}

export function projectLockfileDigest(lockfile: Pick<ProjectLockfile, "bytes">): string {
  return `sha256:${createHash("sha256").update(lockfile.bytes).digest("hex")}`;
}

function supportedNames(names: readonly string[]): ProjectLockfile["name"][] {
  const present = new Set(names);
  return SUPPORTED_PROJECT_LOCKFILES.filter((name) => present.has(name));
}

function requireExactlyOneLockfile(names: readonly ProjectLockfile["name"][]): void {
  if (names.length === 1) return;
  const detail = names.length === 0 ? "none found" : names.join(", ");
  throw new Error(`ReplayLock requires exactly one supported project lockfile (${detail})`);
}

function requireSupportedLockfileName(name: string): ProjectLockfile["name"] {
  if (!SUPPORTED_PROJECT_LOCKFILES.includes(name as ProjectLockfile["name"])) {
    throw new Error("unsupported project lockfile");
  }
  return name as ProjectLockfile["name"];
}

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value);
}
