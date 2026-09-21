import { readFileSync, statSync } from "node:fs";

interface Input { stamp: string; isFile: boolean; text?: string }

/** Files, directories and failed resolution probes all belong to a snapshot.
 * ctime and inode catch replacements and edits whose mtime was restored. The
 * session's watcher can invalidate eagerly; correctness never waits for it.
 */
export function createDevInputTracker() {
  const inputs = new Map<string, Input>();
  function inspect(file: string): Input {
    try {
      const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
      if (!stat) return { stamp: "missing", isFile: false };
      return { stamp: `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`, isFile: stat.isFile() };
    } catch { return { stamp: "missing", isFile: false }; }
  }
  function input(file: string): Input {
    let value = inputs.get(file);
    if (!value) { value = inspect(file); inputs.set(file, value); }
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
      for (const [file, before] of inputs) if (inspect(file).stamp !== before.stamp) return false;
      return true;
    },
  };
}
