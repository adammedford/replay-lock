import { lstatSync, readFileSync, statSync, type BigIntStats } from "node:fs";
import path from "node:path";

interface Input { stat: BigIntStats | undefined; isFile: boolean; isDirectory: boolean; missingParent?: string; text?: string }

/** Files, directories and failed resolution probes all belong to a snapshot.
 * ctime and inode catch replacements and edits whose mtime was restored. The
 * session's watcher can invalidate eagerly; correctness never waits for it.
 */
export function createDevInputTracker() {
  const inputs = new Map<string, Input>();
  function stat(file: string): BigIntStats | undefined {
    try { return statSync(file, { bigint: true, throwIfNoEntry: false }); }
    catch { return undefined; }
  }
  function inspect(file: string): Input {
    const value = stat(file);
    return { stat: value, isFile: value?.isFile() ?? false, isDirectory: value?.isDirectory() ?? false };
  }
  function unchanged(before: BigIntStats | undefined, after: BigIntStats | undefined): boolean {
    if (!before || !after) return before === after;
    return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
      && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
  }
  function input(file: string): Input {
    let value = inputs.get(file);
    if (!value) {
      value = inspect(file);
      inputs.set(file, value);
      if (!value.stat) {
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
      for (const [file, before] of inputs) if (!before.missingParent && !unchanged(before.stat, stat(file))) return false;
      return true;
    },
  };
}
