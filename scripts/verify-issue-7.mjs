import { runIssueVerification } from "./run-issue-verification.mjs";

runIssueVerification({
  issueNumber: 7,
  scenario: process.argv[2] ?? "all",
  scenarios: {
    activation: {
      pattern: "recording activation is capability-gated",
      marker: "recording activation verified",
    },
    transparency: {
      pattern: "instrumentation preserves supported call behavior",
      marker: "recording transparency verified",
    },
    sourcemaps: {
      pattern: "composed source maps retain authored failure locations",
      marker: "recording source maps verified",
    },
    thenables: {
      pattern: "Promise and thenable completions pass through unobserved",
      marker: "thenable pass through verified",
    },
    handshake: {
      pattern: "zero-invocation handshake differs from missing plugin",
      marker: "plugin handshake verified",
    },
    failures: {
      pattern: "wrapped command failure remains primary",
      marker: "wrapped command outcome verified",
    },
    all: {
      pattern: undefined,
      marker: "issue 7 acceptance suite verified",
    },
  },
  testFile: "test/acceptance/recording-wrapper.test.mjs",
});
