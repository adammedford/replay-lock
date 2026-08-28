import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 8,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    values: {
      pattern: "canonical values round-trip",
      marker: "canonical values verified",
    },
    completions: {
      pattern: "canonical completions distinguish",
      marker: "canonical completions verified",
    },
    encoding: {
      pattern: "canonical encoding uses|__proto__|ambiguous or noncanonical",
      marker: "canonical encoding verified",
    },
    comparison: {
      pattern: "exact comparison detects",
      marker: "exact comparison verified",
    },
    stability: {
      pattern: "byte-identical canonical output across processes",
      marker: "canonical stability verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 8 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/canonical.test.mjs",
});
