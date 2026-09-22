# Make development recording responsive without weakening capture safety

## Problem Statement

The adoption pilot measured added medians of 3.04 seconds for cold page load, 99 milliseconds for navigation, and 15.23 seconds for edit-to-visible updates. Repeated analysis makes leaving recording enabled impractical.

## Solution

Optimize analysis and cache validation while preserving eligibility, invocation-level external-read correlation, generation separation, and full reloads. Required added-median ceilings are 2000 ms cold page, 100 ms navigation, and 2000 ms visible update. Timing budgets remain outside correctness CI.

## User Stories

1. As a developer, I want recording to add little startup delay, so that I can begin promptly.
2. As a developer, I want edits to appear quickly, so that recording remains practical.
3. As a developer, I want responsive navigation, so that capture does not interrupt workflows.
4. As a developer, I want existing configuration preserved, so that no migration is required.
5. As a developer, I want unchanged functions to retain eligibility, so that optimization does not alter coverage.
6. As a developer, I want newly effectful functions excluded immediately, so that stale analysis cannot authorize capture.
7. As a developer, I want helper changes detected, so that callers receive accurate decisions.
8. As a developer, I want additions and deletions recognized, so that import resolution stays correct.
9. As a developer, I want package and configuration changes detected, so that analysis reflects my project.
10. As a developer, I want accurate transformed-source analysis, so that other plugins cannot invalidate assumptions.
11. As a developer, I want realms isolated, so that their distinct behavior remains correct.
12. As a developer, I want generations separated across edits, so that provenance stays accurate.
13. As a developer, I want external reads correlated with each invocation, so that offline replay remains faithful.
14. As a developer, I want full reloads preserved, so that this phase introduces no new update semantics.
15. As a maintainer, I want phase-specific profiles, so that changes address measured costs.
16. As a maintainer, I want paired measurements, so that overhead is attributable.
17. As a maintainer, I want failures retained, so that incomplete trials cannot look successful.
18. As a maintainer, I want historical evidence preserved, so that claims remain auditable.
19. As a maintainer, I want differential analysis tests, so that reuse cannot change safety decisions.
20. As a maintainer, I want unmet budgets reported explicitly, so that partial improvement is not completion.

## Implementation Decisions

- Start from merged commit 2f9ff9467608a458e4f37ddc53aec3a6c40d28af in a healthy checkout. Preserve the original checkout with stalled Git reads.
- Pin Epic Stack 8473afd804b66dba6a23f317908dc35d1535e90d, its dependency tree, host integration and business code. Establish a fresh merged baseline; retain previous reports.
- Profile startup and edits separately, including project construction, module analysis, filesystem validation, overlays and realms. Remove temporary instrumentation before final measurement.
- Compute callable-independent source-file analysis facts once per project build. Keep callable-dependent facts separate, preserve existing entrypoints, evidence positions/order and interception coverage. Do not share mutable compiler state across builds.
- Combine authored admission and transformation around one validated snapshot. Keep overlays isolated and unable to bypass authored-source qualification.
- Consolidate redundant edit invalidation while preserving generation changes, configuration reloads, both-realm discovery and full reloads. Retain filesystem freshness validation, missing probes and replacement detection; never trust watcher events alone.
- Retain bounded session-owned caches. No public API, configuration, schema, runtime-support or persistent-cache changes.
- Require five alternating enabled/disabled pairs for baseline and final, fresh processes/browsers and cold cache, without concurrent tests/profiling/pilots. Save raw samples, identities, environment, overhead/ratios and owned cleanup.
- All three ceilings must pass. Missing pairs, failed/time-out workflows and leaked processes invalidate evidence. If a ceiling remains unmet, keep acceptance incomplete; do not relax it or broaden HMR semantics.

## Testing Decisions

User confirmed real Vite/browser and public recording/replay workflows, plus cached-versus-fresh differential analysis tests. Cover safe-to-effectful edits, helpers, restored mtime, additions/deletions, missing imports, exports, aliases, configuration, overlays and realms. Compare diagnostics, transformations, maps and digests. Preserve production exclusion and benchmark negative controls. Finish Node 22 typecheck, full verify, dogfood, diff checks and hosted CI. Refresh stale assumptions only through explicit recording and review.

## Out of Scope

State-preserving HMR, installation redesign, broader eligibility/effect/framework support, real-app nonempty effect-trace demonstration, runtime expansion, publication, telemetry and repair of the original Git storage. No weaker freshness or performance thresholds.

## Further Notes

Sequence: baseline/profiling; optimization; final budget evidence. Publish dependent tickets before implementation.


Published issue: https://github.com/adammedford/replay-lock/issues/72
