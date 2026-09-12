import { readFileSync, statSync } from "node:fs";

/** Files, directories and failed resolution probes all belong to a snapshot.
 * ctime and inode catch replacements and edits whose mtime was restored. The
 * session's watcher can invalidate eagerly; correctness never waits for it.
 */
export function createDevInputTracker() {
  const inputs = new Map<string, string>();
  function stamp(file: string): string {
    try {
      const stat = statSync(file, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch { return "missing"; }
  }
  function track(file: string): void {
    if (!inputs.has(file)) inputs.set(file, stamp(file));
  }
  return {
    track,
    read(file: string): string { track(file); return readFileSync(file, "utf8"); },
    isFile(file: string): boolean {
      track(file);
      try { return statSync(file).isFile(); } catch { return false; }
    },
    isCurrent(): boolean {
      for (const [file, before] of inputs) if (stamp(file) !== before) return false;
      return true;
    },
  };
}
