import {
  artifactJson,
  atomicWrite,
  toCaseArtifact,
  type CandidateArtifact,
  type CaseArtifact,
} from "./model.js";

export type ReviewDecision = "accept" | "reject" | "skip";

export interface CandidateReplacement {
  existing: CaseArtifact;
  candidate: CaseArtifact;
  diff: string;
}

/**
 * Candidate formation suppresses unchanged completions. A freshly reviewed
 * assumption is itself durable evidence, so retain that narrow same-behavior
 * replacement for explicit review without treating ordinary provenance drift
 * as a replacement.
 */
export function retainAssumptionRefreshCandidates(
  formed: readonly CandidateArtifact[],
  observed: readonly CandidateArtifact[],
  accepted: readonly CaseArtifact[],
): CandidateArtifact[] {
  const result = new Map(formed.map((candidate) => [candidate.caseId, candidate]));
  const acceptedById = new Map(accepted.map((artifact) => [artifact.caseId, artifact]));
  const refreshes = new Map<string, CandidateArtifact[]>();
  for (const candidate of observed) {
    if (result.has(candidate.caseId)) continue;
    const existing = acceptedById.get(candidate.caseId);
    if (!existing || !sameCanonicalCompletion(existing, candidate)) continue;
    if (!assumptionChanged(existing, candidate)) continue;
    const group = refreshes.get(candidate.caseId) ?? [];
    group.push(candidate);
    refreshes.set(candidate.caseId, group);
  }
  for (const [caseId, group] of refreshes) {
    const representative = [...group].sort(compareReviewCandidates)[0];
    const existing = acceptedById.get(caseId);
    if (!representative || !existing) continue;
    const occurrences = group.reduce((total, candidate) => {
      const next = total + candidate.occurrences;
      if (!Number.isSafeInteger(next)) throw new RangeError("Candidate occurrence count overflow");
      return next;
    }, 0);
    result.set(caseId, {
      ...representative,
      occurrences,
      replacesCaseId: existing.caseId,
    });
  }
  return [...result.values()].sort(compareReviewCandidates);
}

/** Stable review ordering is independent of filesystem enumeration order. */
export function compareReviewCandidates(
  left: CandidateArtifact,
  right: CandidateArtifact,
): number {
  return compareText(reviewIdentity(left), reviewIdentity(right));
}

/** Render canonical bytes and all evidence; never reconstruct lossy JS values. */
export function formatCandidateReview(candidate: CandidateArtifact): string {
  const lines = [
    `Target: ${candidate.locator.module}#${candidate.locator.exportName}`,
    `Canonical input: ${JSON.stringify(candidate.arguments)}`,
    `Canonical completion: ${JSON.stringify(candidate.completion)}`,
    `Occurrences: ${candidate.occurrences}`,
    `Eligibility: ${candidate.eligibility.verdict}`,
    `Eligibility basis: ${candidate.eligibility.basis}`,
    `Automatic evidence: ${candidate.eligibility.reasonCodes.join(", ")}`,
    `Source graph: ${candidate.provenance.sourceGraphDigest}`,
    `Lockfile: ${candidate.provenance.lockfileDigest}`,
    `Runtime: ${JSON.stringify(candidate.provenance.runtimeProfile)}`,
    `Recording provenance: ${candidate.provenance.captureStatus}`,
  ];
  const assumption = candidate.eligibility.assumption;
  if (assumption) {
    lines.push(
      `Assumption reason: ${assumption.reason}`,
      `Assumption fingerprint: ${assumption.fingerprint}`,
      `Assumption analyzer: ${assumption.analyzerVersion}`,
      `Assumption intrinsic catalog: ${assumption.intrinsicCatalogVersion}`,
      `Assumption original evidence: ${JSON.stringify(assumption.originalEvidence)}`,
    );
  }
  const packageTrust = candidate.eligibility.packageTrust;
  if (packageTrust && packageTrust.length > 0) {
    lines.push(`Trusted package calls: ${packageTrust.map(describeTrustedPackageCall).join(", ")}`);
  }
  return lines.join("\n");
}

/** A deterministic field-oriented diff shown before a replacement decision. */
export function describeReplacement(
  existing: CaseArtifact,
  candidate: CandidateArtifact,
): CandidateReplacement | undefined {
  const replacement = toCaseArtifact(candidate);
  const oldJson = artifactJson(existing);
  const newJson = artifactJson(replacement);
  if (oldJson === newJson) return undefined;
  const oldLines = oldJson.trimEnd().split("\n");
  const newLines = newJson.trimEnd().split("\n");
  return {
    existing,
    candidate: replacement,
    diff: [
      `Replacement diff for ${candidate.locator.module}#${candidate.locator.exportName}:`,
      ...oldLines.map((line) => `- ${line}`),
      ...newLines.map((line) => `+ ${line}`),
    ].join("\n"),
  };
}

/** The only operation allowed to promote a candidate into source-controlled cases. */
export async function acceptReviewedCandidate(
  casePath: string,
  candidate: CandidateArtifact,
): Promise<CaseArtifact> {
  const artifact = toCaseArtifact(candidate);
  await atomicWrite(casePath, artifactJson(artifact));
  return artifact;
}

export function parseReviewDecision(answer: string): ReviewDecision | undefined {
  switch (answer.trim().toLowerCase()) {
    case "a":
    case "accept":
      return "accept";
    case "r":
    case "reject":
      return "reject";
    case "s":
    case "skip":
      return "skip";
    default:
      return undefined;
  }
}

function reviewIdentity(candidate: CandidateArtifact): string {
  return JSON.stringify([
    candidate.locator.module,
    candidate.locator.exportName,
    candidate.arguments,
    candidate.completion,
    candidate.eligibility,
    candidate.provenance,
  ]);
}

function describeTrustedPackageCall(entry: { package: string; export: string; matchedVersion?: string; unpinned: boolean }): string {
  const suffix = entry.unpinned ? " (unpinned)" : entry.matchedVersion ? `@${entry.matchedVersion}` : "";
  return `${entry.package}#${entry.export}${suffix}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameCanonicalCompletion(left: CaseArtifact, right: CandidateArtifact): boolean {
  return JSON.stringify(left.completion) === JSON.stringify(right.completion);
}

function assumptionChanged(left: CaseArtifact, right: CandidateArtifact): boolean {
  const before = left.eligibility.assumption;
  const after = right.eligibility.assumption;
  return after !== undefined && JSON.stringify(before) !== JSON.stringify(after);
}
