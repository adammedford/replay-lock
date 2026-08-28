#!/usr/bin/env bash
# Interprets replaylock verify's exit-code contract and writes a distinct,
# human-readable summary line for each of the three cases, then re-exits
# with the same code so the CI check still fails on 1 or 2. Used by
# replaylock-verify.yml; kept as its own script so the logic is testable
# outside of a real GitHub Actions run (see scripts/verify-issue-33.mjs).
set -euo pipefail

code="$1"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "$code" -eq 0 ]; then
  echo "✅ replaylock verify passed — every accepted case still matches." >> "$summary_file"
elif [ "$code" -eq 1 ]; then
  echo "❌ replaylock verify found a behavioral regression (exit 1). Review the OUTPUT_MISMATCH / COMPLETION_KIND_MISMATCH diff in the log above." >> "$summary_file"
else
  echo "⚠️ replaylock verify hit an infrastructure or configuration failure (exit $code), not necessarily a behavioral regression. Review the diagnostic code in the log above." >> "$summary_file"
fi

exit "$code"
