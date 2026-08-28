import { runIssueVerification } from "./run-issue-verification.mjs";
runIssueVerification({ issueNumber: 19, scenario: process.argv[2] ?? "all", scenarios: {
  recording: { pattern: "recording adapter failure isolation", marker: "recording adapter failure isolation verified" },
  preflight: { pattern: "adapter evolution preflight", marker: "adapter evolution preflight verified" },
  completion: { pattern: "completion adapter failure", marker: "completion adapter failure verified" },
  refactors: { pattern: "adapter refactor stability", marker: "adapter refactor stability verified" },
  arguments: { pattern: "argument adapter evolution", marker: "argument adapter evolution verified" },
  replacement: { pattern: "completion adapter evolution", marker: "completion adapter evolution verified" },
  all: { pattern: undefined, marker: "issue 19 acceptance suite verified" },
}, testFile: "test/acceptance/adapter-evolution.test.mjs" });
