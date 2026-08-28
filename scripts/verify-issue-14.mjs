import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 14,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    schema: { pattern: "malformed and future", marker: "case schema preflight verified" },
    orphan: { pattern: "missing modules and exact exports", marker: "orphaned callable preflight verified" },
    analysis: { pattern: "new refuting", marker: "verification reanalysis verified" },
    safety: { pattern: "removed capture|formerly supported|new refuting|assumption fingerprints", marker: "replay safety preflight verified" },
    sentinels: { pattern: undefined, marker: "pre invocation sentinels verified" },
    exits: { pattern: undefined, marker: "verification preflight exits verified" },
    all: { pattern: undefined, marker: "issue 14 acceptance suite verified" },
  },
  testFile: "test/acceptance/verification-preflight.test.mjs",
});
