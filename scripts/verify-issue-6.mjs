import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 6,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    unknown: { pattern: "unknown targets without assumptions", marker: "unknown effect blocking verified" },
    conflicts: { pattern: "nonempty assumptions resolve only unknown", marker: "assertion conflict handling verified" },
    provenance: { pattern: "review and accepted provenance", marker: "assumption provenance verified" },
    fingerprint: { pattern: "assumption fingerprints cover", marker: "assumption fingerprint verified" },
    stale: { pattern: "fingerprint changes produce", marker: "stale assertion preflight verified" },
    refresh: { pattern: "refresh requires", marker: "explicit assumption refresh verified" },
    all: { pattern: undefined, marker: "issue 6 acceptance suite verified" },
  },
  testFile: "test/acceptance/assumptions.test.mjs",
});
