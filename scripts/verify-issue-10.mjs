import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 10,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    mutation: { pattern: "entry and exit snapshots", marker: "input mutation blocking verified" },
    limits: { pattern: "canonical shape and shared", marker: "observation limits verified" },
    sensitive: { pattern: "specified property names", marker: "sensitive values verified" },
    ordering: { pattern: "safety classification precedes", marker: "safety ordering verified" },
    diagnostics: { pattern: "blocked diagnostics expose", marker: "safe diagnostics verified" },
    isolation: { pattern: "unsafe invocations are discarded", marker: "observation isolation verified" },
    all: { pattern: undefined, marker: "issue 10 acceptance suite verified" },
  },
  testFile: "test/acceptance/observation-safety.test.mjs",
});

