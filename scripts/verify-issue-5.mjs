import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 5,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    calls: { pattern: "identifier calls and named local imports", marker: "transitive local calls verified" },
    recursion: { pattern: "recursive local call groups", marker: "recursive verdicts verified" },
    initialization: { pattern: "initialization of every reachable", marker: "module initialization verified" },
    members: { pattern: "unique local instance method", marker: "unique member resolution verified" },
    unknown: { pattern: "ambiguous dispatch", marker: "unknown evidence verified" },
    excluded: { pattern: "effects from an excluded", marker: "excluded effect propagation verified" },
    all: { pattern: undefined, marker: "issue 5 acceptance suite verified" },
  },
  testFile: "test/acceptance/call-graph.test.mjs",
});

