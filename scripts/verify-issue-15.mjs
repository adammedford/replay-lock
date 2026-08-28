import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 15,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    harness: { pattern: "ephemeral fresh-process", marker: "fresh replay harness verified" },
    mismatch: { pattern: "structural output and completion-kind", marker: "behavioral mismatch diagnostics verified" },
    errors: { pattern: "standard errors", marker: "safe replay diffs verified" },
    exits: { pattern: "exit codes", marker: "verification exit contract verified" },
    immutable: { pattern: "read-only", marker: "immutable verification verified" },
    refactors: { pattern: "stable locators", marker: "refactor stable verification verified" },
    all: { pattern: undefined, marker: "issue 15 acceptance suite verified" },
  },
  testFile: "test/acceptance/verification-replay.test.mjs",
});
