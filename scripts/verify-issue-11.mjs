import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 11,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    storage: {
      pattern: "observation storage is ignored and private",
      marker: "session storage policy verified",
    },
    workers: {
      pattern: "workers register, write isolated completed chunks",
      marker: "worker session protocol verified",
    },
    concurrency: {
      pattern: "concurrent sessions stay isolated",
      marker: "concurrent session isolation verified",
    },
    partial: {
      pattern: "non-closing writers, storage errors, malformed aggregation",
      marker: "partial session detection verified",
    },
    preservation: {
      pattern: "complete safe records survive partial sessions",
      marker: "partial session preservation verified",
    },
    exits: {
      pattern: "partial success exits two",
      marker: "partial session exits verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 11 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/sessions.test.mjs",
});
