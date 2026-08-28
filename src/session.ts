import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const SESSION_PARTIAL = "SESSION_PARTIAL" as const;

export interface SessionFailure {
  code: typeof SESSION_PARTIAL;
  reason: "MALFORMED_CHUNK" | "NON_CLOSING_WRITER" | "STORAGE_FAILURE";
  workerId?: string;
}

export interface SessionAggregation<T> {
  records: T[];
  failures: SessionFailure[];
  partial: boolean;
}

interface WorkerRegistration {
  token: string;
  workerId: string;
  pid: number;
}

interface CompletedChunk<T> {
  token: string;
  workerId: string;
  sequence: number;
  record: T;
}

export interface SessionWorker<T> {
  readonly workerId: string;
  writeCompleted(record: T): void;
  close(): void;
}

/**
 * Register one process-local writer. A call becomes durable only as a complete
 * chunk; registration and close markers deliberately contain no captured
 * arguments or completion values.
 */
export function registerSessionWorker<T>(
  sessionDirectory: string,
  token: string,
  workerId = `${process.pid}-${randomUUID()}`,
): SessionWorker<T> {
  assertSessionCapability(sessionDirectory, token);
  assertWorkerId(workerId);
  const workerDirectory = path.join(sessionDirectory, "workers", workerId);
  const chunksDirectory = path.join(workerDirectory, "chunks");
  ensurePrivateDirectory(chunksDirectory);
  atomicWriteSync(
    path.join(workerDirectory, "registered.json"),
    JSON.stringify({ token, workerId, pid: process.pid } satisfies WorkerRegistration),
  );

  let sequence = 0;
  let closed = false;
  return {
    workerId,
    writeCompleted(record: T): void {
      if (closed) throw new Error("Session worker is already closed");
      const chunk: CompletedChunk<T> = { token, workerId, sequence, record };
      const filename = `${String(sequence).padStart(12, "0")}-${randomUUID()}.complete.json`;
      sequence += 1;
      atomicWriteSync(path.join(chunksDirectory, filename), JSON.stringify(chunk));
    },
    close(): void {
      if (closed) return;
      atomicWriteSync(
        path.join(workerDirectory, "closed.json"),
        JSON.stringify({ token, workerId, completedChunks: sequence }),
      );
      closed = true;
    },
  };
}

/** Aggregate only atomically completed chunks from registered workers. */
export function aggregateSession<T>(
  sessionDirectory: string,
  token: string,
  validate: (value: unknown) => T,
): SessionAggregation<T> {
  assertSessionCapability(sessionDirectory, token);
  const records: T[] = [];
  const failures: SessionFailure[] = [];
  const reportedFailuresDirectory = path.join(sessionDirectory, "failures");
  try {
    for (const filename of sortedEntries(reportedFailuresDirectory)) {
      if (!filename.endsWith(".json")) continue;
      const value = JSON.parse(
        readFileSync(path.join(reportedFailuresDirectory, filename), "utf8"),
      ) as Partial<SessionFailure>;
      if (value.code !== SESSION_PARTIAL || value.reason !== "STORAGE_FAILURE") {
        throw new Error("Malformed session failure marker");
      }
      failures.push({ code: SESSION_PARTIAL, reason: "STORAGE_FAILURE" });
    }
  } catch (error) {
    if (!isMissingClose(error)) {
      failures.push({ code: SESSION_PARTIAL, reason: "STORAGE_FAILURE" });
    }
  }
  const workersDirectory = path.join(sessionDirectory, "workers");
  let workerNames: string[];
  try {
    workerNames = sortedEntries(workersDirectory);
  } catch (error) {
    if (isMissingClose(error)) {
      return { records, failures, partial: failures.length > 0 };
    }
    return partial(records, { code: SESSION_PARTIAL, reason: "STORAGE_FAILURE" });
  }

  for (const workerName of workerNames) {
    const workerDirectory = path.join(workersDirectory, workerName);
    try {
      const registration = parseRegistration(
        readFileSync(path.join(workerDirectory, "registered.json"), "utf8"),
        token,
        workerName,
      );
      const chunks = sortedEntries(path.join(workerDirectory, "chunks")).filter((name) =>
        name.endsWith(".complete.json"),
      );
      for (let index = 0; index < chunks.length; index += 1) {
        const filename = chunks[index];
        if (!filename) continue;
        const chunk = parseChunk(
          readFileSync(path.join(workerDirectory, "chunks", filename), "utf8"),
          token,
          workerName,
          index,
        );
        records.push(validate(chunk.record));
      }
      try {
        const closed = parseClose(
          readFileSync(path.join(workerDirectory, "closed.json"), "utf8"),
          token,
          registration.workerId,
        );
        if (closed.completedChunks !== chunks.length) {
          failures.push({ code: SESSION_PARTIAL, reason: "NON_CLOSING_WRITER", workerId: workerName });
        }
      } catch (error) {
        if (!isMissingClose(error)) throw error;
        failures.push({ code: SESSION_PARTIAL, reason: "NON_CLOSING_WRITER", workerId: workerName });
      }
    } catch (error) {
      failures.push({ code: SESSION_PARTIAL, reason: "MALFORMED_CHUNK", workerId: workerName });
    }
  }
  return { records, failures, partial: failures.length > 0 };
}

/** Best-effort, value-free fault marker used when a runtime writer cannot persist a call. */
export function reportSessionStorageFailure(sessionDirectory: string, token: string): void {
  try {
    assertSessionCapability(sessionDirectory, token);
    const directory = path.join(sessionDirectory, "failures");
    ensurePrivateDirectory(directory);
    atomicWriteSync(
      path.join(directory, `${process.pid}-${randomUUID()}.json`),
      JSON.stringify({ code: SESSION_PARTIAL, reason: "STORAGE_FAILURE" }),
    );
  } catch {
    // The session root itself may be unavailable. Recording must remain
    // observational and must not replace application behavior.
  }
}

/** Atomic replacement used for both pending candidates and accepted cases. */
export function replaceArtifactAtomic(filePath: string, contents: string): void {
  ensurePrivateDirectory(path.dirname(filePath));
  atomicWriteSync(filePath, contents);
}

function partial<T>(records: T[], failure: SessionFailure): SessionAggregation<T> {
  return { records, failures: [failure], partial: true };
}

function parseRegistration(text: string, token: string, workerId: string): WorkerRegistration {
  const value = JSON.parse(text) as Partial<WorkerRegistration>;
  if (value.token !== token || value.workerId !== workerId || !Number.isInteger(value.pid)) {
    throw new Error("Malformed session worker registration");
  }
  return value as WorkerRegistration;
}

function parseClose(
  text: string,
  token: string,
  workerId: string,
): { completedChunks: number } {
  const value = JSON.parse(text) as {
    token?: unknown;
    workerId?: unknown;
    completedChunks?: unknown;
  };
  if (
    value.token !== token ||
    value.workerId !== workerId ||
    !Number.isSafeInteger(value.completedChunks) ||
    Number(value.completedChunks) < 0
  ) {
    throw new Error("Malformed session worker close marker");
  }
  return { completedChunks: Number(value.completedChunks) };
}

function parseChunk(
  text: string,
  token: string,
  workerId: string,
  sequence: number,
): CompletedChunk<unknown> {
  const value = JSON.parse(text) as Partial<CompletedChunk<unknown>>;
  if (value.token !== token || value.workerId !== workerId || value.sequence !== sequence || !("record" in value)) {
    throw new Error("Malformed completed session chunk");
  }
  return value as CompletedChunk<unknown>;
}

function sortedEntries(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
}

function atomicWriteSync(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${contents}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
}

function assertSessionCapability(sessionDirectory: string, token: string): void {
  if (!path.isAbsolute(sessionDirectory) || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Invalid ReplayLock session capability");
  }
}

function assertWorkerId(workerId: string): void {
  if (
    workerId === "." ||
    workerId === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workerId)
  ) {
    throw new Error("Session worker ID must be one safe filename segment");
  }
}

function isMissingClose(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
