import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export const scanWorkerArgument = "--replaylock-scan-worker";

// A configuration module can open resources before Vite owns its plugins.
// Keep those resources, including non-detached descendants, outside the CLI.
export async function runScanProcess(arguments_: string[]): Promise<number> {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), scanWorkerArgument, ...arguments_], {
    cwd: process.cwd(), stdio: ["inherit", "inherit", "inherit", "ipc"],
    detached: process.platform !== "win32",
  });
  let completed: number | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping ??= stopScanProcess(child);
  const interrupted = (): void => { completed = 2; void stop(); };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  try {
    return await new Promise<number>(resolve => {
      child.on("message", message => {
        if (completed !== undefined || !message || typeof message !== "object" || !("scanStatus" in message)) return;
        const status = message.scanStatus;
        if (status !== 0 && status !== 1 && status !== 2) return;
        completed = status;
        void stop();
      });
      child.once("error", () => { console.error("SCAN_INFRASTRUCTURE_FAILED: scan worker could not start"); resolve(2); });
      child.once("exit", async () => {
        await stop();
        if (completed === undefined) console.error("SCAN_INFRASTRUCTURE_FAILED: scan worker exited before completing");
        resolve(completed ?? 2);
      });
    });
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    await stop();
  }
}

async function stopScanProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>(resolve => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => { child.kill(); resolve(); });
      killer.once("exit", () => resolve());
    });
    return;
  }
  const signal = (name: NodeJS.Signals): void => {
    try { process.kill(-child.pid!, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  signal("SIGTERM");
  // The leader can exit before a descendant releases inherited resources.
  // Always finish cleanup of the owned group, even after the leader exits.
  await new Promise(resolve => setTimeout(resolve, 250));
  signal("SIGKILL");
}

export async function finishScanWorker(status: number): Promise<void> {
  await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>((resolve, reject) => {
    stream.write("", error => error ? reject(error) : resolve());
  })));
  await new Promise<void>((resolve, reject) => {
    process.send!({ scanStatus: status }, error => error ? reject(error) : resolve());
  });
}
