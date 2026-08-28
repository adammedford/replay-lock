import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 17,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    realms: { pattern: "realm local adapter registry", marker: "realm local adapter registry verified" },
    registration: { pattern: "adapter registration diagnostics", marker: "adapter registration diagnostics verified" },
    matching: { pattern: "exact prototype matching", marker: "exact prototype matching verified" },
    identities: { pattern: "adapter identity isolation", marker: "adapter identity isolation verified" },
    payloads: { pattern: "adapter payload boundary", marker: "adapter payload boundary verified" },
    budgets: { pattern: "adapted traversal budgets", marker: "adapted traversal budgets verified" },
    all: { pattern: undefined, marker: "issue 17 acceptance suite verified" },
  },
  testFile: "test/acceptance/adapter-registry.test.mjs",
});
