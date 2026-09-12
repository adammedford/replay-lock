# Make development capture measurable, bounded, and diagnosable

## Problem Statement

ReplayLock records arguments, correlated external reads, and completions during local development. We need evidence that it produces useful regression cases in real applications without excessive review effort or development overhead. Fresh random/time values continually create candidates, exclusions and replay failures have limited explanations, and project analysis repeats across transformations. Broader systematic checks must establish that instrumentation preserves application behavior.

## Solution

Run reproducible public pilots; bound candidate retention without changing retained correlations; share analysis and benchmark costs; explain capture outcomes and replay differences; and generate conformance tests comparing original, instrumented and replayed execution. Use the public record/review/verify workflow for acceptance and existing transform/runtime APIs for generated checks and measurements.

## User Stories

1. As a developer, I want recording attached to normal development workflows.
2. As a developer, I want to know which functions were considered for capture.
3. As a developer, I want to distinguish eligible functions that ran from those never exercised.
4. As a developer, I want exclusions to identify their source and dependency.
5. As a developer, I want frequently called functions to have bounded candidate allowances.
6. As a developer, I want different explicit inputs and effect sequences represented.
7. As a developer, I want configurable retention limits.
8. As a developer, I want retained cases to preserve exact arguments, external reads and completions.
9. As a developer, I want intentional omissions distinguished from lost observations.
10. As a developer, I want recovery to respect the original retention policy.
11. As a reviewer, I want grouped callable/input/effect presentation.
12. As a reviewer, I want accepted expectations preserved until explicit replacement.
13. As a reviewer, I want the first differing completion field identified.
14. As a reviewer, I want the first divergent effect identified.
15. As a reviewer, I want tolerance applied consistently to decisions and explanations.
16. As a tooling author, I want machine-readable reports.
17. As a developer, I want reports to exclude captured argument, response and result values.
18. As a developer, I want source/configuration changes to invalidate analysis correctly.
19. As a developer, I want fresh-process verification isolation.
20. As a maintainer, I want reproducible recording/replay benchmarks.
21. As a maintainer, I want generated evaluation-order, completion and effect-count checks.
22. As a maintainer, I want failures reproducible from a seed.
23. As a maintainer, I want observer failures and limits to leave application behavior intact.
24. As a maintainer, I want a browser pilot using existing application workflows.
25. As a maintainer, I want an SSR pilot using local synthetic data.
26. As a maintainer, I want compatibility failures reported without overstating pilot success.

## Implementation Decisions

### Sequence and pilots

Establish baseline measurements and pilot scripts, then implement conformance, reporting, retention and shared analysis. Rerun pilots and benchmarks against the resulting package. Preserve current uncommitted capture implementation as the baseline.

- Browser: [Homer daa017dfe1ea8d0875697aede091319b6134bb4b](https://github.com/bastienwirtz/homer/tree/daa017dfe1ea8d0875697aede091319b6134bb4b): bundled dashboard configuration, service filtering, local dummy services.
- SSR: [Epic Stack 8473afd804b66dba6a23f317908dc35d1535e90d](https://github.com/epicweb-dev/epic-stack/tree/8473afd804b66dba6a23f317908dc35d1535e90d): existing/nonexistent seeded-user searches, profile and notes navigation.
- Isolated checkouts, declared package managers, packed ReplayLock installation. Preserve application dependency versions; record failures rather than upgrading frameworks to manufacture compatibility.
- Save revisions, package/lockfile digests, commands, environments, timings, counts and reproducible blockers. Successful captures proceed through review, offline replay, a behavior-preserving edit and a seeded output regression.
- Unsupported syntax/dependencies/host compatibility become documented follow-ups. Human review timing is explicitly unmeasured without a human participant.

### Retention

- Add `capture.retention: false | {maxPerCallable?, maxPerGroup?}`. Default 20 candidates per callable/environment and 2 per group; false preserves legacy behavior.
- Groups comprise canonical explicit arguments and ordered trace structure (event kinds, operations, call/settlement relationships). Exclude external values and function completion. Preserve current case identity.
- Admit first distinct extended inputs within allowances. Session admission is stable: omitted identities cannot later enter because completion changed. Existing pending cases consume allowances and lowering limits never deletes them.
- Central admission follows validation and precedes durable observation storage. Native application code/reads execute normally regardless of admission. Admitted identities still undergo same-generation completion conflict checks and latest-completed-generation selection.
- Accepted identity reobservations remain eligible for explicit replacements under project limits. Sampling does not silently suppress replacements. Integers must satisfy `1 <= maxPerGroup <= maxPerCallable <= 1000`; existing project-wide safety limits remain.
- Persist resolved policy and admission state. Recovery uses original policy and sealed observations; older sessions preserve legacy behavior. Count policy omissions separately; they alone do not make a session partial.
- Group review presentation without group auto-acceptance or trace rewriting.

### Reports and differences

- Add `scan --dev --json` and `report --session <id> [--json]`.
- Persist a versioned value-free session report including callable/environment, generation, eligibility, invocation/completion counts, retained candidates, duplicates, omissions, runtime blocks and completeness.
- Count invocation before encoding. Excluded functions remain uninstrumented and have unknown execution. Browser counters use acknowledged deduplicated envelopes; lost delivery marks counts partial.
- Diagnostics include source positions and bounded originating call/dependency chains. Reports remain separate from accepted V2 artifacts.
- Preserve diagnostic codes and exits. Completion differences identify callable, realm, case, kind, first differing path and bounded expected/actual excerpts. Effect differences identify first divergent index, operation and argument difference, including missing/additional effects.
- Comparison and explanation share tolerance logic. Validate actual values before rendering; unsupported/sensitive values receive value-free explanations. Caught trace mismatches remain latched.

### Analysis and performance

- Session-owned immutable project snapshots shared by discovery/transforms and separated by environment/options. Different source overlays must not reuse mismatching AST positions.
- Invalidate relevant source additions/edits/deletions, aliases, configuration, package metadata and dependency changes. Preserve current HMR generation behavior and retain only the current base snapshot per environment.
- Verification revalidates current source and physical locators; each case remains serial and isolated in a fresh process. Record startup costs; parallel replay is follow-up work.
- `npm run bench:dev` covers 10/100/1000-module projects and 1/10/100-case replay; extended mode includes 1000 cases. Record cold load, edit-to-ready latency, invocation overhead, replay duration and peak memory.
- Baseline is identified by packed-artifact digest, including pre-existing uncommitted changes. Five paired runs on the same host target at least 50% lower median cold-load time at 1000 modules, and small-fixture regression no larger than max(10%,20ms). Report replay timings without promising speedup.
- Timing gates are explicitly invoked through comparison/check mode, outside ordinary correctness CI.

## Testing Decisions

Tests observe externally visible behavior through existing CLI/Vite, packed-consumer and transform/runtime seams.

- Retention: 10,000 completed calls with drained transport, at most two same-group random cases, available capacity for other inputs/functions; conflicts, replacements, existing pending cases, recovery and disabled policy.
- Reporting: unexercised eligibility, runtime rejection, policy omission, transport loss and unknown execution are distinct. Retries do not inflate counters. Seeded values never appear in reports.
- Differences: nested changes, return/throw, tolerance, effect arguments, missing/extra effects, caught mismatches and unrenderable values.
- Cache: helpers, aliases, package exports, overlays, filenames and physical locators change. Cached and fresh analysis agree and unsafe changes block replay.
- Conformance: 32 fixed seeds per realm and normal/reverse/interleaved settlement patterns. Compare original/instrumented completion, evaluation order, mutation and effect counts under identical controlled inputs. Replay performs no native reads. Extended mode uses 1000 seeds; seed reruns and minimized regression fixtures preserve failures. Include observer failure, capacity exhaustion, nesting, rejection and detached-work rejection.
- Final: Node 22 typecheck, locked acceptance manifest, packed consumers, production inactivity and Chromium browser checks.

Blocked public pilots are findings, not successful journeys. Controlled Node/browser journeys must still produce accepted cases, replay offline and detect regressions.

## Out of Scope

New hosts, framework-language support, effect providers, workspaces, additional Node versions, parallel replay, automatic expectation approval, accepted-case migrations, package publication and hosted telemetry.

## Further Notes

User chose public pilots, both testing boundaries, and separate compatibility follow-ups. Publish this spec to adammedford/replay-lock with ready-for-agent. A blocked public pilot is an allowed measured result; unmet core acceptance checks are not completion.
