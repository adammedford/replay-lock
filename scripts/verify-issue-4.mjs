import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 4,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    eligible: {
      pattern: "eligible local calculations",
      marker: "direct effect eligibility verified",
    },
    effects: {
      pattern: "every specified direct effect",
      marker: "direct refuting effects verified",
    },
    diagnostics: {
      pattern: "stable codes and authored source locations",
      marker: "effect diagnostics verified",
    },
    runtime: {
      pattern: "runtime observations cannot upgrade",
      marker: "static verdict separation verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 4 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/effects.test.mjs",
});
