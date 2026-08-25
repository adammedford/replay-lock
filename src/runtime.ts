import { appendFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  isReplayNumber,
  REPLAYLOCK_VERSION,
  type CaptureMetadata,
  type Observation,
  type RuntimeProfile,
} from "./model.js";

const require = createRequire(import.meta.url);
const vitePackage = require("vite/package.json") as { version: string };
const vitestPackage = require("vitest/package.json") as { version: string };

export function observeCall<T>(
  metadata: CaptureMetadata,
  arguments_: unknown[],
  invoke: () => T,
): T {
  const result = invoke();
  const sessionDirectory = process.env.REPLAYLOCK_SESSION_DIR;
  const token = process.env.REPLAYLOCK_SESSION_TOKEN;

  if (
    sessionDirectory &&
    token &&
    arguments_.every(isReplayNumber) &&
    isReplayNumber(result)
  ) {
    const observation: Observation = {
      token,
      locator: metadata.locator,
      arguments: [...arguments_],
      completion: { kind: "return", value: result },
      sourceGraphDigest: metadata.sourceGraphDigest,
      runtimeProfile: runtimeProfile(),
    };
    try {
      mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
      appendFileSync(
        path.join(sessionDirectory, `worker-${process.pid}.jsonl`),
        `${JSON.stringify(observation)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      // Recording must not replace the application's successful return.
    }
  }

  return result;
}

function runtimeProfile(): RuntimeProfile {
  const internationalization = new Intl.DateTimeFormat().resolvedOptions();
  return {
    node: process.version,
    vite: vitePackage.version,
    vitest: vitestPackage.version,
    replaylock: REPLAYLOCK_VERSION,
    platform: process.platform,
    architecture: process.arch,
    timezone: internationalization.timeZone ?? "unknown",
    locale: internationalization.locale,
  };
}
