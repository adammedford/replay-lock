import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { normalizeModuleLocator } from "./model.js";

export type CallableModuleLocatorResolution =
  | { ok: true; locator: string; source: string }
  | { ok: false; source: string; message: string };

export function resolveCallableModuleLocator(
  projectRoot: string,
  modulePath: string,
): CallableModuleLocatorResolution {
  const absoluteRoot = path.resolve(projectRoot);
  const absoluteModule = path.resolve(modulePath);
  const relative = path.relative(absoluteRoot, absoluteModule);
  const source = relative.replaceAll(path.sep, "/") || path.basename(absoluteModule);
  let locator: string;
  try {
    locator = normalizeModuleLocator(relative);
  } catch {
    return { ok: false, source, message: "callable module is outside the project root" };
  }

  let current = absoluteRoot;
  for (const segment of relative.split(path.sep)) {
    let matches: string[];
    try {
      const foldedSegment = segment.toLowerCase();
      matches = readdirSync(current).filter((entry) => entry.toLowerCase() === foldedSegment);
    } catch {
      return { ok: false, source, message: "callable module path cannot be resolved" };
    }
    if (matches.length !== 1 || matches[0] !== segment) {
      return { ok: false, source, message: "callable module path has ambiguous casing" };
    }
    current = path.join(current, segment);
  }

  try {
    const physicalRelative = path.relative(realpathSync(absoluteRoot), realpathSync(absoluteModule));
    normalizeModuleLocator(physicalRelative);
  } catch {
    return { ok: false, source, message: "callable module is outside the project root" };
  }

  return { ok: true, locator, source: locator };
}
