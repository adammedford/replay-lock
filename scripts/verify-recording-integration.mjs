import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: "recording-integration",
  scenario: "all",
  scenarios: {
    all: { pattern: undefined, marker: "recording branch integration verified" },
  },
  testFile: "test/acceptance/recording-integration.test.mjs",
});
