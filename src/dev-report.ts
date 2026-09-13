import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { assertDevSafe } from "./dev-values.js";
import type { DevAnalysis, DevBlock, DevDiagnostic, DevEnvironment, DevLocator, DevMetadata } from "./dev-contract.js";

export interface DevCounts { invoked: number; completed: number }
export interface DevCountEntry extends DevCounts { metadata: DevMetadata }
export interface DevReportRow {
  locator: DevLocator;
  environment: DevEnvironment;
  generation: string;
  eligibility: "eligible" | "blocked";
  execution: "unexercised" | "observed" | "unknown";
  invoked: number | null;
  completed: number | null;
  observations: number;
  retained: number;
  duplicates: number;
  omitted: number;
  blocks: Record<string, number>;
  diagnostics: DevDiagnostic[];
}
export interface DevSessionReport {
  schemaVersion: 1;
  session: string;
  status: "recording" | "complete" | "partial";
  countsComplete: boolean;
  rows: DevReportRow[];
  blocks: Record<string, number>;
}
const sessionPattern = /^[a-f0-9-]{36}$/;
const codePattern = /^[A-Z][A-Z_0-9]{0,79}$/;
const reportLimit = 8 * 1024 * 1024;
const MAX_ROWS = 10_000;
function invalid(): never { throw new Error("INVALID_REPORT"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function label(value: unknown, maximum = 1024): string {
  if (typeof value !== "string" || !value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) return invalid();
  assertDevSafe(value);
  return value;
}
function locator(value: unknown): DevLocator {
  const raw = object(value);
  const module = label(raw.module);
  if (module.startsWith("/") || module.includes("\\") || module.split("/").some(part => part === "." || part === ".." || !part) || /^[A-Za-z]:/.test(module)) return invalid();
  if (!["export", "local", "nested"].includes(String(raw.kind)) || !Array.isArray(raw.namePath) || !raw.namePath.length || raw.namePath.length > 32) return invalid();
  return { module, kind: raw.kind as DevLocator["kind"], namePath: raw.namePath.map(name => label(name, 256)) };
}
function environment(value: unknown): DevEnvironment { if (value !== "node" && value !== "browser") return invalid(); return value; }
export function parseDevMetadata(value: unknown): DevMetadata {
  const raw = object(value);
  if (Object.keys(raw).sort().join() !== "environment,generation,locator,sourceGraphDigest") return invalid();
  const sourceGraphDigest = label(raw.sourceGraphDigest, 80);
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(sourceGraphDigest)) return invalid();
  return { locator: locator(raw.locator), environment: environment(raw.environment), generation: label(raw.generation, 80), sourceGraphDigest };
}
export function parseDevCounts(value: unknown): DevCountEntry[] {
  if (!Array.isArray(value) || value.length > 128) return invalid();
  return value.map(entry => {
    const raw = object(entry);
    if (Object.keys(raw).sort().join() !== "completed,invoked,metadata") return invalid();
    return { metadata: parseDevMetadata(raw.metadata), invoked: count(raw.invoked), completed: count(raw.completed) };
  });
}
function blockCounts(value: unknown): Record<string, number> {
  const raw = object(value);
  if (Object.keys(raw).length > 256) return invalid();
  const result: Record<string, number> = {};
  for (const [code, amount] of Object.entries(raw)) { if (!codePattern.test(code)) return invalid(); result[code] = count(amount); }
  return result;
}
function diagnostic(value: unknown): DevDiagnostic {
  const raw = object(value);
  if (!codePattern.test(String(raw.code))) return invalid();
  if (typeof raw.message !== "string" || !raw.message || raw.message.length > 4096 || /[\x00-\x1f\x7f]/.test(raw.message)) return invalid();
  // Rebuild the projection: arbitrary artifact fields are never reflected by report.
  // The locator is already structured below. Repeating it as "name: code"
  // can look like a credential assignment (e.g. "getPassword: UNKNOWN_CALL").
  // Keep arbitrary message text out of the value-free report altogether.
  const result: DevDiagnostic = { code: String(raw.code), message: String(raw.code) };
  if (raw.locator !== undefined) result.locator = locator(raw.locator);
  const position = (value: unknown) => {
    const item = object(value);
    const module = locator({ module: item.module, kind: "local", namePath: ["position"] }).module;
    const line = count(item.line), column = count(item.column);
    if (!line || !column) return invalid();
    return { module, line, column };
  };
  if (raw.position !== undefined) result.position = position(raw.position);
  if (raw.causes !== undefined) {
    if (!Array.isArray(raw.causes) || raw.causes.length > 32) return invalid();
    result.causes = raw.causes.map(cause => {
      const item = object(cause);
      if (!codePattern.test(String(item.code))) return invalid();
      return { code: String(item.code), position: position(item.position) };
    });
  }
  return result;
}
export function parseDevReport(value: unknown): DevSessionReport {
  const raw = object(value);
  if (raw.schemaVersion !== 1 || typeof raw.session !== "string" || !sessionPattern.test(raw.session) || !["recording", "complete", "partial"].includes(String(raw.status)) || typeof raw.countsComplete !== "boolean" || !Array.isArray(raw.rows) || raw.rows.length > MAX_ROWS) return invalid();
  const rows: DevReportRow[] = raw.rows.map(value => {
    const entry = object(value);
    if (!["eligible", "blocked"].includes(String(entry.eligibility)) || !["unexercised", "observed", "unknown"].includes(String(entry.execution)) || !Array.isArray(entry.diagnostics) || entry.diagnostics.length > 128) return invalid();
    return { locator: locator(entry.locator), environment: environment(entry.environment), generation: label(entry.generation, 80),
      eligibility: entry.eligibility as DevReportRow["eligibility"], execution: entry.execution as DevReportRow["execution"],
      invoked: entry.invoked === null ? null : count(entry.invoked), completed: entry.completed === null ? null : count(entry.completed),
      observations: count(entry.observations), retained: count(entry.retained), duplicates: count(entry.duplicates), omitted: count(entry.omitted),
      blocks: blockCounts(entry.blocks), diagnostics: entry.diagnostics.map(diagnostic) };
  });
  return { schemaVersion: 1, session: raw.session, status: raw.status as DevSessionReport["status"], countsComplete: raw.countsComplete, rows, blocks: blockCounts(raw.blocks) };
}

const key = (entry: Pick<DevMetadata, "locator" | "environment" | "generation">) => JSON.stringify([entry.environment, entry.locator, entry.generation]);
const add = (target: Record<string, number>, code: string): void => { target[code] = count((target[code] ?? 0) + 1); };

/** Contains only validated static metadata and counts, never observation values. */
export function createDevSessionReport(session: string, initial?: DevSessionReport) {
  if (!sessionPattern.test(session)) return invalid();
  const report: DevSessionReport = initial ? parseDevReport(initial) : { schemaVersion: 1, session, status: "recording", countsComplete: false, rows: [], blocks: {} };
  if (report.session !== session) return invalid();
  const rows = new Map(report.rows.map(row => [key(row), row]));
  const rowFor = (metadata: Pick<DevMetadata, "locator" | "environment" | "generation">, eligible = true): DevReportRow | undefined => {
    const id = key(metadata);
    let row = rows.get(id);
    if (!row && rows.size >= MAX_ROWS) { add(report.blocks, "REPORT_LIMIT"); return undefined; }
    if (!row) {
      row = { locator: locator(metadata.locator), environment: environment(metadata.environment), generation: label(metadata.generation, 80), eligibility: eligible ? "eligible" : "blocked", execution: eligible ? "unexercised" : "unknown", invoked: eligible ? 0 : null, completed: eligible ? 0 : null, observations: 0, retained: 0, duplicates: 0, omitted: 0, blocks: {}, diagnostics: [] };
      rows.set(id, row);
    }
    return row;
  };
  return {
    discover(analysis: DevAnalysis, environment: DevEnvironment, generation: string) {
      for (const target of analysis.targets) rowFor({ locator: target.locator, environment, generation });
      for (const finding of analysis.diagnostics) {
        if (!finding.locator) continue;
        const row = rowFor({ locator: finding.locator, environment, generation }, false);
        const projected = diagnostic(finding);
        if (row && row.diagnostics.length < 128 && !row.diagnostics.some(entry => JSON.stringify(entry) === JSON.stringify(projected))) row.diagnostics.push(projected);
      }
    },
    counts(entries: DevCountEntry[]) {
      const updates = new Map<DevReportRow, DevCounts>();
      for (const entry of entries) {
        const row = rowFor(entry.metadata);
        if (!row) continue;
        const previous = updates.get(row) ?? { invoked: row.invoked ?? 0, completed: row.completed ?? 0 };
        updates.set(row, { invoked: count(previous.invoked + entry.invoked), completed: count(previous.completed + entry.completed) });
      }
      for (const [row, next] of updates) {
        row.invoked = next.invoked;
        row.completed = next.completed;
        if (row.invoked || row.completed) row.execution = "observed";
      }
    },
    observation(metadata: DevMetadata, status: "retained" | "duplicate" | "omitted" | "limit") {
      const row = rowFor(metadata);
      if (!row) return;
      row.execution = "observed";
      row.observations++;
      if (status === "retained") row.retained++;
      if (status === "duplicate") row.duplicates++;
      if (status === "omitted") row.omitted++;
    },
    recover(entries: { metadata: DevMetadata; caseId: string }[]) {
      const sealed = new Map<string, { metadata: DevMetadata; count: number; identities: Set<string> }>();
      for (const entry of entries) {
        const id = key(entry.metadata);
        const group = sealed.get(id) ?? { metadata: entry.metadata, count: 0, identities: new Set<string>() };
        group.count++; group.identities.add(entry.caseId); sealed.set(id, group);
      }
      for (const group of sealed.values()) {
        const row = rowFor(group.metadata);
        if (!row) continue;
        row.execution = "observed";
        row.observations = Math.max(row.observations, group.count);
        row.retained = Math.max(row.retained, group.identities.size);
        row.duplicates = Math.max(row.duplicates, group.count - group.identities.size);
        // A crash can seal an observation before the corresponding count batch.
        // Preserve known counts, but never present a stale zero as no execution.
        if ((row.invoked ?? 0) < group.count) row.invoked = null;
        if ((row.completed ?? 0) < group.count) row.completed = null;
      }
    },
    block(block: DevBlock) {
      if (!codePattern.test(block.code)) return;
      add(report.blocks, block.code);
      if (block.metadata) { const row = rowFor(block.metadata); if (row) add(row.blocks, block.code); }
    },
    snapshot(status: DevSessionReport["status"] = "recording"): DevSessionReport {
      const complete = status === "complete" && Object.keys(report.blocks).length === 0
        && [...rows.values()].every(row => row.eligibility === "blocked" || row.invoked === row.completed && (row.completed ?? 0) >= row.observations);
      return parseDevReport({ ...report, status, countsComplete: complete, rows: [...rows.values()].sort((a, b) => key(a).localeCompare(key(b))) });
    },
  };
}

export async function readDevSessionReport(root: string, session: string): Promise<DevSessionReport> {
  if (!sessionPattern.test(session)) throw new Error("INVALID_SESSION_ID");
  const base = await realpath(root);
  const requested = path.join(base, ".replaylock", "observations", "dev-sessions", session, "report.json");
  const file = await realpath(requested);
  if (file !== requested || (await stat(file)).size > reportLimit) return invalid();
  const report = parseDevReport(JSON.parse(await readFile(file, "utf8")));
  if (report.session !== session) return invalid();
  return report;
}

export function formatDevReport(report: DevSessionReport): string {
  const result = [`ReplayLock session ${report.session}: ${report.status}; counts ${report.countsComplete ? "complete" : "partial/provisional"}`];
  for (const row of report.rows) {
    result.push(`${row.environment} ${row.locator.module}#${row.locator.namePath.join(".")} [${row.generation}] ${row.eligibility}, ${row.execution}: invoked=${row.invoked ?? "unknown"}, completed=${row.completed ?? "unknown"}, retained=${row.retained}, duplicates=${row.duplicates}, omitted=${row.omitted}`);
    for (const finding of row.diagnostics) result.push(formatDevDiagnostic(finding));
    for (const [code, amount] of Object.entries(row.blocks)) result.push(`  ${code}: ${amount}`);
  }
  for (const [code, amount] of Object.entries(report.blocks)) result.push(`${code}: ${amount}`);
  return result.join("\n");
}
export function formatDevDiagnostic(finding: DevDiagnostic): string {
  const where = finding.position ? `${finding.position.module}:${finding.position.line}:${finding.position.column}` : finding.locator?.module ?? "";
  return `  ${finding.code} ${where}${finding.causes?.length ? ` via ${finding.causes.map(cause => `${cause.code} ${cause.position.module}:${cause.position.line}:${cause.position.column}`).join(" -> ")}` : ""}`;
}
