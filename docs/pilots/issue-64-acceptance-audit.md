# Issue #64 acceptance audit after PR #110

This is an evidence map, not a new pilot or a claim of human review timing. The existing [results](results.md) preserve baseline/final application compatibility failures, controlled journeys, extended conformance and paired performance measurements. The later [Epic mutation pilot](epic-mutation-2026-09-27.md) measures regression protection separately from eligibility.

| Requirement group | Executable checks | Committed evidence / interpretation |
| --- | --- | --- |
| Bounded retention, distinct inputs/trace groups, replacements, recovery, disabled policy | `test/acceptance/dev-retention.test.mjs`, `dev-artifacts.test.mjs` | The 10,000-call test asserts native execution and bounded retained correlations; accepted replacements and original recovery policy remain covered. |
| Value-free reports, eligibility vs invocation, runtime rejection vs omission, loss/retry counts | `test/acceptance/dev-reporting.test.mjs` | Reports expose counts without captured values; lost delivery is not inferred successful. |
| Completion and trace diagnostics, sensitive/unrenderable values, latched mismatch | `test/acceptance/dev-diagnostics.test.mjs`, `dev-artifacts.test.mjs` | V2 comparison and explanation already share tolerance behavior. The separate V1 attribution defect #78 must land before closing this audit. |
| Shared immutable analysis, overlays, aliases, configuration, dependencies, physical locators | `test/acceptance/dev-analysis-cache.test.mjs`, `verification-preflight.test.mjs` | Cache and replay safety checks exercise current source, not stale analysis or elapsed-mtime assumptions. |
| Generated conformance and observer/pending/detached hazards | `test/acceptance/dev-conformance.test.mjs` | [conformance.json](conformance.json) records the original extended 1,000-seed run per realm; normal CI reruns the bounded fixed corpus. |
| Reproducible public browser/SSR pilots without dependency changes | `test/acceptance/dev-pilots.test.mjs` | [baseline.json](baseline.json), [final.json](final.json) preserve Homer/Epic blockers. [epic-middleware.json](epic-middleware.json) and [epic-mutation-2026-09-27.json](epic-mutation-2026-09-27.json) are separate follow-ups, not rewritten baseline claims. |
| Same-host paired performance budgets and honest replay cost | `test/acceptance/dev-pilots.test.mjs` validates the oracle and negative controls | [performance.json](performance.json) and [results](results.md) record five original alternating pairs, analysis/transform scope and no replay-speedup claim. No new timing run is implied. |
| Node 22, packed consumer, Chromium, production inactivity | `npm run typecheck`, `npm run verify`, `npm run verify:dogfood` | Final commands must pass on the delivered revision before reconciliation is reported complete. |

## Closure boundary

Issue #64 permits blocked public pilots as measured compatibility findings and requires human timing to stay unmeasured without a participant. It does not require the later declared-external-call capabilities. Keep #64 open until the #78 fix and this evidence map land with passing verification; then reconcile its criteria rather than rebuild the feature.

Issue #105 separately requires genuine per-case review timings and a user-set ceiling. Its human gate remains open; #106 must not begin merely because this audit passes. The broader roadmap and user evidence gates after #107/#108 remain unchanged. Compatibility requests #37–40 are deferred, not rejected or silently closed.
