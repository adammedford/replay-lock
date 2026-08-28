import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const supportedConfigurationFilenames = [
  "replaylock.config.ts",
  "replaylock.config.mts",
  "replaylock.config.js",
  "replaylock.config.mjs",
  "replaylock.config.cts",
  "replaylock.config.cjs",
] as const;

export async function findProjectConfiguration(
  root: string,
): Promise<string | undefined> {
  for (const filename of supportedConfigurationFilenames) {
    const candidate = path.join(root, filename);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (isFileNotFound(error)) continue;
      throw error;
    }
  }
  return undefined;
}

export function findProjectConfigurationSync(root: string): string | undefined {
  for (const filename of supportedConfigurationFilenames) {
    const candidate = path.join(root, filename);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (isFileNotFound(error)) continue;
      throw error;
    }
  }
  return undefined;
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
