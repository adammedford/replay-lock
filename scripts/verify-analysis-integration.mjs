import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: "analysis-integration",
  scenario: "all",
  scenarios: {
    all: {
      pattern: undefined,
      marker: "analysis branch integration verified",
    },
  },
  testFile: "test/acceptance/analysis-integration.test.mjs",
});
