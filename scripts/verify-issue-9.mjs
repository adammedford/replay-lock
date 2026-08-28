import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 9,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    categories: {
      pattern: "unsupported V1 categories",
      marker: "unsupported categories verified",
    },
    identity: {
      pattern: "cycles, repeated references",
      marker: "unsafe identity verified",
    },
    proxies: {
      pattern: "Node proxy detection",
      marker: "proxy rejection verified",
    },
    noninvoking: {
      pattern: "inspection invokes no getters",
      marker: "non invoking inspection verified",
    },
    shapes: {
      pattern: "array extras, sparse arrays",
      marker: "unsafe shapes verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 9 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/canonical-safety.test.mjs",
});
