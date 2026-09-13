import { types } from "node:util";
import type { DevCandidate, DevRetentionPolicy } from "./dev-contract.js";
import { createDevCallableId, createDevGroupId, DEV_ARTIFACT_LIMITS, loadDevArtifactIndex } from "./dev-artifacts.js";
import { resolveDevRetention } from "./dev-options.js";

export interface DevAdmission {
  status: "retained" | "duplicate" | "omitted" | "limit";
  reason?: string;
}
interface Identity { caseId: string; callableId: string; groupId: string }
interface Decision extends Omit<DevAdmission, "status"> {
  caseId: string;
  status: "retained" | "omitted" | "limit";
}
/** Only identities and policy are saved here; captured values remain in sealed observations. */
export interface DevRetentionSnapshot {
  schemaVersion: 1;
  policy: false | DevRetentionPolicy;
  acceptedCaseIds: string[];
  acceptedCount: number;
  pending: Identity[];
  admissions: Decision[];
}
export interface DevRetentionRecovery {
  snapshot?: DevRetentionSnapshot;
  /** Validated candidates reconstructed from observations already sealed by the collector. */
  admitted?: readonly DevCandidate[];
}
export interface DevRetention {
  policy: false | DevRetentionPolicy;
  /** The collector must validate before admission and store both retained and duplicate observations. */
  admit(candidate: DevCandidate): DevAdmission;
  snapshot(): DevRetentionSnapshot;
}

const idPattern = /^[a-f0-9]{64}$/;
const omissionReasons = new Set(["RETENTION_GROUP_LIMIT", "RETENTION_CALLABLE_LIMIT"]);
const limitReasons = new Set(["PENDING_LIMIT", "PROJECT_LIMIT"]);
function invalid(): never { throw Object.assign(new Error("INVALID_RETENTION_STATE"), { code: "INVALID_RETENTION_STATE" }); }
function record(input: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== "string" || !keys.includes(key) && !optional.includes(key))
    || Object.values(descriptors).some(value => !("value" in value) || !value.enumerable)
    || keys.some(key => !Object.hasOwn(input, key))) invalid();
  return input as Record<string, unknown>;
}
function id(input: unknown): string { if (typeof input !== "string" || !idPattern.test(input)) invalid(); return input; }
function identity(candidate: DevCandidate): Identity {
  return { caseId: candidate.caseId, callableId: createDevCallableId(candidate), groupId: createDevGroupId(candidate) };
}

/** A session owns monotonically growing allowances and immutable decisions, independent of completions. */
export async function loadDevRetention(root: string, input?: false | Partial<DevRetentionPolicy>, recovery: DevRetentionRecovery = {}): Promise<DevRetention> {
  const resolved = resolveDevRetention(input ?? recovery.snapshot?.policy);
  const policy = resolved === false ? false : Object.freeze(resolved);
  const accepted = new Set<string>();
  let acceptedCount = 0, additions = 0;
  const pending = new Map<string, Identity>();
  const decisions = new Map<string, DevAdmission>();
  const callableCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();

  function reserve(entry: Identity): void {
    const previous = pending.get(entry.caseId);
    if (previous) {
      if (previous.callableId !== entry.callableId || previous.groupId !== entry.groupId) invalid();
      return;
    }
    pending.set(entry.caseId, entry);
    callableCounts.set(entry.callableId, (callableCounts.get(entry.callableId) ?? 0) + 1);
    groupCounts.set(entry.groupId, (groupCounts.get(entry.groupId) ?? 0) + 1);
    if (!accepted.has(entry.caseId)) additions++;
  }

  if (recovery.snapshot !== undefined) {
    const snapshot = record(recovery.snapshot, ["schemaVersion", "policy", "acceptedCaseIds", "acceptedCount", "pending", "admissions"]);
    if (snapshot.schemaVersion !== 1) invalid();
    const savedPolicy = snapshot.policy === false ? false : record(snapshot.policy, ["maxPerCallable", "maxPerGroup"]);
    if (policy === false ? savedPolicy !== false
      : savedPolicy === false || savedPolicy.maxPerCallable !== policy.maxPerCallable || savedPolicy.maxPerGroup !== policy.maxPerGroup) invalid();
    if (!Array.isArray(snapshot.acceptedCaseIds) || !Array.isArray(snapshot.pending) || !Array.isArray(snapshot.admissions)
      || snapshot.acceptedCaseIds.length > 1000 || snapshot.pending.length > 1000 || snapshot.admissions.length > 1000) invalid();
    for (const entry of snapshot.acceptedCaseIds) { const key = id(entry); if (accepted.has(key)) invalid(); accepted.add(key); }
    if (!Number.isSafeInteger(snapshot.acceptedCount) || (snapshot.acceptedCount as number) < accepted.size || (snapshot.acceptedCount as number) > 1000) invalid();
    acceptedCount = snapshot.acceptedCount as number;
    for (const entry of snapshot.pending) {
      const node = record(entry, ["caseId", "callableId", "groupId"]);
      const key = id(node.caseId);
      if (pending.has(key)) invalid();
      reserve({ caseId: key, callableId: id(node.callableId), groupId: id(node.groupId) });
    }
    for (const entry of snapshot.admissions) {
      const node = record(entry, ["caseId", "status"], ["reason"]);
      const key = id(node.caseId);
      if (decisions.has(key)) invalid();
      if (node.status === "retained") {
        if (!pending.has(key) || node.reason !== undefined) invalid();
        decisions.set(key, { status: "retained" });
      } else if (node.status === "omitted" || node.status === "limit") {
        if (pending.has(key) || typeof node.reason !== "string" || !(node.status === "omitted" ? omissionReasons : limitReasons).has(node.reason)) invalid();
        decisions.set(key, { status: node.status, reason: node.reason });
      } else invalid();
    }
  } else {
    const artifacts = await loadDevArtifactIndex(root);
    for (const key of artifacts.accepted.keys()) accepted.add(key);
    acceptedCount = artifacts.acceptedFiles.length;
    for (const candidate of artifacts.pending.values()) reserve(identity(candidate));
  }

  // Crash recovery restores admission, not a new sample under the filesystem's current quotas.
  for (const candidate of recovery.admitted ?? []) {
    const previous = decisions.get(candidate.caseId);
    if (previous && previous.status !== "retained") invalid();
    reserve(identity(candidate));
    decisions.set(candidate.caseId, { status: "retained" });
  }

  return {
    policy,
    admit(candidate) {
      const previous = decisions.get(candidate.caseId);
      if (previous) return previous.status === "retained" ? { status: "duplicate" } : { ...previous };
      const entry = identity(candidate);
      let decision: DevAdmission = { status: "retained" };
      if (!pending.has(entry.caseId)) {
        // Accepted identities always reach conflict detection and explicit replacement review.
        if (policy && !accepted.has(entry.caseId) && (groupCounts.get(entry.groupId) ?? 0) >= policy.maxPerGroup) {
          decision = { status: "omitted", reason: "RETENTION_GROUP_LIMIT" };
        } else if (policy && !accepted.has(entry.caseId) && (callableCounts.get(entry.callableId) ?? 0) >= policy.maxPerCallable) {
          decision = { status: "omitted", reason: "RETENTION_CALLABLE_LIMIT" };
        } else if (pending.size >= DEV_ARTIFACT_LIMITS.maxPendingUnique) {
          decision = { status: "limit", reason: "PENDING_LIMIT" };
        } else if (!accepted.has(entry.caseId) && acceptedCount + additions >= DEV_ARTIFACT_LIMITS.maxProjectUnique) {
          decision = { status: "limit", reason: "PROJECT_LIMIT" };
        }
      }
      if (decision.status === "retained") reserve(entry);
      // Quotas only grow during a session and group identity excludes completion.
      // An omitted input therefore stays omitted without an unbounded rejection log.
      if (decision.status === "retained") decisions.set(entry.caseId, decision);
      return { ...decision };
    },
    snapshot() {
      return {
        schemaVersion: 1, policy: policy === false ? false : { ...policy },
        acceptedCaseIds: [...accepted], acceptedCount,
        pending: [...pending.values()].map(entry => ({ ...entry })),
        admissions: [...decisions].map(([caseId, decision]) => ({ caseId, ...decision } as Decision)),
      };
    },
  };
}
