import { lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface Input { stamp: string; isFile: boolean; isDirectory: boolean; missingParent?: string; text?: string }

/** Files, directories and failed resolution probes all belong to a snapshot.
 * ctime and inode catch replacements and edits whose mtime was restored. The
 * session's watcher can invalidate eagerly; correctness never waits for it.
 */
export function createDevInputTracker() {
  const inputs = new Map<string, Input>();
  function inspect(file: string): Input {
    try {
      const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
      if (!stat) return { stamp: "missing", isFile: false, isDirectory: false };
      return { stamp: `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    } catch { return { stamp: "missing", isFile: false, isDirectory: false }; }
  }
  function input(file: string): Input {
    let value = inputs.get(file);
    if (!value) {
      value = inspect(file);
      inputs.set(file, value);
      if (value.stamp === "missing") {
        const parent = path.dirname(file);
        const directory = inputs.get(parent) ?? inspect(parent);
        // Absence of an entry is stable while its existing parent directory is
        // unchanged. A dangling link is different: its target can appear without
        // touching this directory, so it must keep its own fresh stat probe.
        try {
          if (directory.isDirectory && !lstatSync(file, { throwIfNoEntry: false })) {
            inputs.set(parent, directory);
            value.missingParent = parent;
          }
        } catch { /* Inaccessible paths retain direct validation. */ }
      }
    }
    return value;
  }
  return {
    track(file: string): void { input(file); },
    read(file: string): string {
      const value = input(file);
      return value.text ??= readFileSync(file, "utf8");
    },
    isFile(file: string): boolean { return input(file).isFile; },
    isCurrent(): boolean {
      for (const [file, before] of inputs) if (!before.missingParent && inspect(file).stamp !== before.stamp) return false;
      return true;
    },
  };
}
