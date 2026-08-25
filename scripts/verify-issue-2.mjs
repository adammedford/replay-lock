import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 2,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    record: {
      pattern: "record observes one natural call without synthetic invocation",
      marker: "record observation verified",
    },
    review: {
      pattern: "one explicit acceptance creates one deterministic case and no generated test",
      marker: "review acceptance verified",
    },
    verify: {
      pattern: "verify uses fresh Vitest and reports behavior drift without changing the case",
      marker: "verify behavior verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 2 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/core.test.mjs",
});
