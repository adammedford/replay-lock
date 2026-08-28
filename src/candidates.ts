import type {
  CallableLocator,
  CandidateArtifact,
  CaseArtifact,
} from "./model.js";
import { isObject, validateObservation, type Observation } from "./model.js";

export const OBSERVED_NONDETERMINISM = "OBSERVED_NONDETERMINISM" as const;

export type CandidateBlockCode =
  | typeof OBSERVED_NONDETERMINISM
  | "MUTATED_INPUT"
  | "SENSITIVE_VALUE"
  | "OVERSIZED_OBSERVATION"
  | "INCOMPLETE_OBSERVATION"
  | "UNSUPPORTED_VALUE"
  | "VALUE_ADAPTER_BLOCK"
  | "VALUE_ADAPTER_SERIALIZE_FAILED"
  | "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED"
  | "PENDING_LIMIT"
  | "PROJECT_LIMIT";

/** A block is deliberately valueless: it may identify the call, never its capture. */
export interface CandidateBlock {
  code: CandidateBlockCode;
  locator: CallableLocator;
  /** Safe input identity; present for candidate conflicts, never captured values. */
  caseId?: string;
  safePath?: string;
}

/** An incomplete record is also valueless and need not know which call was interrupted. */
export interface IncompleteCandidateRecord {
  code: "INCOMPLETE_OBSERVATION" | "SESSION_PARTIAL";
  locator?: CallableLocator;
}

export type PendingCandidateState =
  | { state: "candidate"; candidate: CandidateArtifact }
  | { state: "blocked"; block: CandidateBlock }
  | { state: "incomplete"; incomplete: IncompleteCandidateRecord };

export interface CandidateFormationInput {
  observations: readonly CandidateArtifact[];
  acceptedCases?: readonly CaseArtifact[];
  blocked?: readonly CandidateBlock[];
  incomplete?: readonly IncompleteCandidateRecord[];
}

export type CandidateSessionRecord =
  | { state: "observation"; observation: Observation }
  | { state: "blocked"; block: CandidateBlock };

/** Accept legacy observation chunks and the valueless block envelope. */
export function validateCandidateSessionRecord(value: unknown): CandidateSessionRecord {
  try {
    return { state: "observation", observation: validateObservation(value) };
  } catch {
    // Continue with the only other valid completed-record shape.
  }
  if (!isObject(value) || value.state !== "blocked" || !isObject(value.block)) {
    throw new Error("Malformed candidate session record");
  }
  const block = value.block;
  const allowedBlockKeys = new Set(["code", "locator", "caseId", "safePath"]);
  if (Object.keys(block).some((key) => !allowedBlockKeys.has(key))) {
    throw new Error("Blocked session records must not contain captured values");
  }
  if (
    !isCandidateBlockCode(block.code) ||
    !isObject(block.locator) ||
    typeof block.locator.module !== "string" ||
    typeof block.locator.exportName !== "string" ||
    block.locator.module.length === 0 ||
    block.locator.exportName.length === 0 ||
    (block.caseId !== undefined &&
      (typeof block.caseId !== "string" || !/^[a-f0-9]{64}$/.test(block.caseId))) ||
    (block.safePath !== undefined && typeof block.safePath !== "string")
  ) {
    throw new Error("Malformed valueless observation block");
  }
  return {
    state: "blocked",
    block: {
      code: block.code,
      locator: { module: block.locator.module, exportName: block.locator.exportName },
      ...(typeof block.caseId === "string" ? { caseId: block.caseId } : {}),
      ...(typeof block.safePath === "string" ? { safePath: block.safePath } : {}),
    },
  };
}

/**
 * Forms one deterministic session result. Conflict detection happens before
 * any candidate is emitted, so input order can never create last-write-wins.
 */
export function formPendingCandidateStates(input: CandidateFormationInput): PendingCandidateState[] {
  const acceptedByInput = new Map<string, CaseArtifact>();
  for (const accepted of [...(input.acceptedCases ?? [])].sort(compareArtifacts)) {
    acceptedByInput.set(inputKey(accepted), accepted);
  }

  const groups = new Map<string, CandidateArtifact[]>();
  for (const observation of input.observations) {
    const key = inputKey(observation);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  const states: PendingCandidateState[] = [];
  for (const key of [...groups.keys()].sort(compareText)) {
    const group = groups.get(key) ?? [];
    const completions = new Map<string, CandidateArtifact[]>();
    for (const candidate of group) {
      const completionKey = JSON.stringify(candidate.completion);
      const matching = completions.get(completionKey) ?? [];
      matching.push(candidate);
      completions.set(completionKey, matching);
    }

    if (completions.size > 1) {
      const first = group[0];
      if (first) {
        states.push({
          state: "blocked",
          block: {
            code: OBSERVED_NONDETERMINISM,
            locator: { ...first.locator },
            caseId: first.caseId,
          },
        });
      }
      continue;
    }

    const matching = completions.values().next().value as CandidateArtifact[] | undefined;
    if (!matching || matching.length === 0) continue;
    const representative = [...matching].sort(compareArtifacts)[0];
    if (!representative) continue;
    const occurrences = matching.reduce((total, candidate) => {
      const next = total + candidate.occurrences;
      if (!Number.isSafeInteger(next)) throw new RangeError("Candidate occurrence count overflow");
      return next;
    }, 0);
    const accepted = acceptedByInput.get(key);
    if (accepted && sameCompletion(accepted, representative)) continue;
    states.push({
      state: "candidate",
      candidate: {
        ...representative,
        locator: { ...representative.locator },
        occurrences,
        ...(accepted ? { replacesCaseId: accepted.caseId } : {}),
      },
    });
  }

  for (const block of input.blocked ?? []) {
    states.push({
      state: "blocked",
      block: {
        code: block.code,
        locator: { ...block.locator },
        ...(block.caseId === undefined ? {} : { caseId: block.caseId }),
        ...(block.safePath === undefined ? {} : { safePath: block.safePath }),
      },
    });
  }
  for (const incomplete of input.incomplete ?? []) {
    states.push({
      state: "incomplete",
      incomplete: {
        code: incomplete.code,
        ...(incomplete.locator ? { locator: { ...incomplete.locator } } : {}),
      },
    });
  }
  return states.sort(compareStates);
}

export function candidateStates(states: readonly PendingCandidateState[]): CandidateArtifact[] {
  return states
    .filter((state): state is Extract<PendingCandidateState, { state: "candidate" }> => state.state === "candidate")
    .map((state) => state.candidate);
}

export function observationBlocksAreNonFatal(states: readonly PendingCandidateState[]): boolean {
  return states.every((state) => state.state !== "incomplete");
}

function inputKey(artifact: CaseArtifact): string {
  return JSON.stringify([artifact.locator.module, artifact.locator.exportName, artifact.arguments]);
}

function sameCompletion(left: CaseArtifact, right: CaseArtifact): boolean {
  return JSON.stringify(left.completion) === JSON.stringify(right.completion);
}

function compareArtifacts(left: CaseArtifact, right: CaseArtifact): number {
  return (
    compareText(inputKey(left), inputKey(right)) ||
    compareText(JSON.stringify(left.completion), JSON.stringify(right.completion)) ||
    compareText(JSON.stringify(left.provenance), JSON.stringify(right.provenance))
  );
}

function compareStates(left: PendingCandidateState, right: PendingCandidateState): number {
  return compareText(stateKey(left), stateKey(right));
}

function stateKey(state: PendingCandidateState): string {
  if (state.state === "candidate") {
    return `0:${inputKey(state.candidate)}:${JSON.stringify(state.candidate.completion)}`;
  }
  if (state.state === "blocked") {
    return `1:${state.block.locator.module}:${state.block.locator.exportName}:${state.block.code}:${state.block.caseId ?? ""}:${state.block.safePath ?? ""}`;
  }
  const locator = state.incomplete.locator;
  return `2:${locator?.module ?? ""}:${locator?.exportName ?? ""}:${state.incomplete.code}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCandidateBlockCode(value: unknown): value is CandidateBlockCode {
  return typeof value === "string" && new Set<CandidateBlockCode>([
    OBSERVED_NONDETERMINISM,
    "MUTATED_INPUT",
    "SENSITIVE_VALUE",
    "OVERSIZED_OBSERVATION",
    "INCOMPLETE_OBSERVATION",
    "UNSUPPORTED_VALUE",
    "VALUE_ADAPTER_BLOCK",
    "VALUE_ADAPTER_SERIALIZE_FAILED",
    "VALUE_ADAPTER_PAYLOAD_UNSUPPORTED",
    "PENDING_LIMIT",
    "PROJECT_LIMIT",
  ]).has(value as CandidateBlockCode);
}
