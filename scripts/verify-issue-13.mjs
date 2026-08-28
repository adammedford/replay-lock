import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 13,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    display: { pattern: "candidate display shows", marker: "candidate display verified" },
    decisions: { pattern: "accept reject and skip", marker: "review decisions verified" },
    pending: { pattern: "reject removes only", marker: "review pending behavior verified" },
    acceptance: { pattern: "acceptance writes deterministic", marker: "accepted artifact verified" },
    nondurable: { pattern: "accepted artifacts exclude", marker: "non durable provenance verified" },
    replacement: { pattern: "replacement shows old versus new", marker: "review replacement diff verified" },
    all: { pattern: undefined, marker: "issue 13 acceptance suite verified" },
  },
  testFile: "test/acceptance/review.test.mjs",
});
