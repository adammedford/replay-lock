import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 16,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    config: { pattern: "configured domain adapter", marker: "adapter configuration verified" },
    journey: { pattern: "configured domain adapter", marker: "adapted characterization journey verified" },
    identity: { pattern: "configured domain adapter", marker: "original adapted value verified" },
    artifact: { pattern: "configured domain adapter", marker: "adapted artifact verified" },
    review: { pattern: "configured domain adapter", marker: "adapted review verified" },
    purity: { pattern: "cannot erase purity evidence", marker: "adapter purity separation verified" },
    all: { pattern: undefined, marker: "issue 16 acceptance suite verified" },
  },
  testFile: "test/acceptance/adapters-journey.test.mjs",
});
