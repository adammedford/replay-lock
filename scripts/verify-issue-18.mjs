import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 18,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    entry: { pattern: "adapter entry validation", marker: "adapter entry validation verified" },
    preservation: { pattern: "adapter entry preservation", marker: "adapter entry preservation verified" },
    isolation: { pattern: "isolated adapter validation", marker: "isolated adapter validation verified" },
    diagnostics: { pattern: "safe adapter diagnostics", marker: "safe adapter diagnostics verified" },
    preflight: { pattern: "adapter replay preflight", marker: "adapter replay preflight verified" },
    completion: { pattern: "adapted completion comparison", marker: "adapted completion comparison verified" },
    all: { pattern: undefined, marker: "issue 18 acceptance suite verified" },
  },
  testFile: "test/acceptance/adapter-validation.test.mjs",
});
