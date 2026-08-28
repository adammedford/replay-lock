import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 12,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    states: { pattern: "pending states distinguish", marker: "pending states verified" },
    duplicates: { pattern: "identical observations merge", marker: "duplicate observations verified" },
    nondeterminism: { pattern: "within-session completion conflicts", marker: "observed nondeterminism verified" },
    replacement: { pattern: "later behavior changes become replacement", marker: "replacement candidates verified" },
    isolation: { pattern: "observation-scoped blocks retain", marker: "candidate isolation verified" },
    exits: { pattern: "observation-scoped blocks are non-fatal", marker: "candidate block exits verified" },
    all: { pattern: undefined, marker: "issue 12 acceptance suite verified" },
  },
  testFile: "test/acceptance/candidates.test.mjs",
});
