import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 3,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    policy: {
      pattern: "source policy captures supported direct exports",
      marker: "source policy selection verified",
    },
    invalid: {
      pattern: "invalid source policies",
      marker: "invalid policy handling verified",
    },
    unsupported: {
      pattern: "annotated unsupported callable shapes",
      marker: "unsupported callable handling verified",
    },
    locators: {
      pattern: "callable locators|case artifacts reject traversal|physically escapes|case-fold collision",
      marker: "callable locator rules verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 3 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/source-policy.test.mjs",
});
