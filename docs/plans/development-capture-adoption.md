# Make development capture reliable and prove useful application coverage

## Problem Statement

A developer can connect ReplayLock to a local middleware-hosted application, but that does not yet ensure useful characterization tests or reliable unattended operation. The latest pinned Epic Stack run completed four existing workflows but retained zero observations and zero candidates, with seven recording blocks. A diagnostic run identified a timer factory returning an object with a closure as an unsupported value. The final pilot also required explicit termination of a detached npm application group after recording finished.

Controlled capture, review, offline replay, and regression checks already pass. The remaining gap is reliable operation and demonstrated value in an existing application. Cold browser navigation also exceeded an earlier 30-second timeout; increasing that timeout is not evidence that development latency is acceptable.

This spec follows GitHub issue #64. It preserves its historical measurements and adds separate evidence for the next phase.

## Solution

First make launched-server cleanup bounded and reliable while preserving externally owned servers. Then use representative existing application functions to identify the smallest useful capture opportunity. Measure the actual browser development workflow with recording enabled and disabled. Finally demonstrate a complete characterization journey against an unchanged application workflow using the packed library.

Work proceeds in that order. Capture analysis is a concrete decision deliverable, not blanket authorization to serialize closures or broaden supported frameworks. The final application journey remains an explicit acceptance requirement; a blocked pilot records an unresolved outcome rather than satisfying it.

## User Stories

1. As a developer, I want recording to stop the server it launched, so that my terminal and ports are usable afterward.
2. As a developer, I want interrupted startup to clean up owned descendants, so that a failed attempt does not leave hidden processes.
3. As a developer, I want an attached server to remain running after recording stops, so that my existing development session continues.
4. As a developer, I want repeated stop requests to be handled consistently, so that overlapping shutdown events do not corrupt a session.
5. As a developer, I want shutdown to finish within a documented bound, so that automation cannot wait indefinitely.
6. As a developer, I want completed observations preserved during shutdown, so that useful captures survive an interrupted session.
7. As a developer, I want missing acknowledgements reported honestly, so that partial captures do not appear complete.
8. As a maintainer, I want process ownership established at launch, so that cleanup cannot terminate unrelated applications.
9. As a maintainer, I want process-tree and controller races reproduced through public commands, so that a fix addresses the actual failure.
10. As a developer, I want to understand why useful application functions are excluded, so that I can judge whether ReplayLock fits my project.
11. As a developer, I want static exclusions distinguished from runtime value rejection, so that I can act on the correct limitation.
12. As a maintainer, I want representative callables ranked by application value and implementation cost, so that compatibility work has a concrete payoff.
13. As a developer, I want existing supported functions considered first, so that adoption does not require rewriting business logic.
14. As a maintainer, I want unsupported returned closures identified explicitly, so that serialization does not silently discard behavior.
15. As a developer, I want each invocation's external reads to remain correlated with its arguments and completion, so that captured nondeterminism replays faithfully.
16. As a developer, I want recording overhead measured during actual navigation, so that I can assess its impact while developing.
17. As a developer, I want HMR measured through visible updated behavior, so that a fast transform alone is not mistaken for a responsive application.
18. As a maintainer, I want repeatable enabled/disabled measurements, so that optimization decisions are based on comparable runs.
19. As a maintainer, I want timeouts and failures retained in performance evidence, so that slow runs are not silently discarded.
20. As a developer, I want ordinary application workflows to produce reviewable candidates, so that setup yields practical regression protection.
21. As a developer, I want reviewed cases to replay offline, so that verification does not depend on fresh external values.
22. As a developer, I want harmless refactors to preserve accepted behavior, so that characterization tests remain useful during maintenance.
23. As a developer, I want a deliberate behavior regression to fail verification, so that I know the captured cases detect meaningful changes.
24. As a maintainer, I want pinned source, package, and runner identities in evidence, so that another developer can reproduce the result.
25. As a maintainer, I want pilot cleanup verified automatically, so that a manual intervention cannot be mistaken for unattended success.
26. As a maintainer, I want unsupported outcomes and unresolved acceptance criteria preserved, so that successful infrastructure tests do not overstate application adoption.

## Implementation Decisions

### 1. Owned process lifecycle

- Reproduce the interaction between the recording controller, pilot runner, npm launcher, and application descendants before assigning a root cause. A controller sending a signal is insufficient proof that descendants exited.
- Centralize the launched-process lifecycle behind the existing recording command. Establish process ownership at creation and retain it through startup, recording, stop, failure, and cleanup. Attachment grants no ownership of the application's process tree.
- Define one idempotent shutdown path. Keep signal handling active until that path completes; wait for owned processes to exit and use bounded escalation where supported. Never select processes for termination by a shared port or broad process-name match.
- Adopt a proposed 15-second total cleanup bound once shutdown begins: allow 10 seconds for graceful termination and the remainder for escalation and exit confirmation. Exercise the bound through integration tests. Keep a separate bounded startup/control deadline.
- Preserve sealed observations and existing partial-capture semantics. Cleanup failure must be visible and must not turn an incomplete run into success. Do not invent completed observations during recovery.
- Cover supported platform behavior explicitly. Do not claim portable descendant cleanup from POSIX-only evidence, or expand the supported runtime contract as part of this work.
- Make the pilot wait for controller cleanup before closing its own supervision. Record whether escalation or manual intervention was necessary. Manual intervention disqualifies unattended success.

### 2. Useful capture opportunity

- Produce a ranked inventory of at least ten existing application callables across at least two existing workflows. Record their purpose, static eligibility or exclusion, evidence of invocation where available, input/output portability, and the smallest plausible enabling change.
- Use the pinned Epic Stack workload as the first evidence source. Excluded callables remain uninstrumented; never infer that they executed merely because a page was visited.
- Separate static analysis restrictions, effect restrictions, unsupported values, lack of invocation, and retention decisions. Retain value-free explanations and source attribution without logging captured secrets.
- Prefer already-supported callables and configuration changes within the existing contract. If that application has no useful supported opportunity, select and pin another application after a read-only fit assessment; record the selection rationale and keep the failed Epic result.
- Deliver a recommended narrow capability change with concrete target functions and proposed acceptance checks when current support is insufficient. Implementing new closure semantics, framework languages, effect providers, or value contracts requires a separate follow-up spec. Do not manufacture a passing pilot by inserting demonstration functions or changing application dependencies.

### 3. Development latency evidence

- Extend the explicit benchmark/pilot tooling to measure cold page load, existing application navigation, and edit-to-visible-update latency. Compare recording enabled with recording disabled using otherwise equivalent host setup and pinned dependencies.
- Run at least five alternating paired measurements on the same host without concurrent project verification or another pilot. Define cold-cache preparation and warm-up policy before collecting results and apply them consistently.
- Record raw samples, failures, timeouts, environment, revisions, artifact digests, and absolute and relative overhead. Report medians only alongside the raw observations. A timed-out sample remains a failed or censored sample, not the timeout duration treated as a successful latency.
- Use temporary profiling only to attribute measured overhead. Restore source and remove instrumentation before final measurements.
- Deliver a proposed development-latency budget based on those measurements, with rationale and a machine-readable comparison rule. This phase establishes the budget; it does not retroactively assert an unagreed performance threshold or promise a percentage improvement.
- Keep performance comparisons explicitly invoked and outside ordinary correctness CI. Do not reinterpret the earlier synthetic transform benchmark as a browser-load benchmark.

### 4. Existing-application characterization journey

- Install the final packed library in an isolated pinned application checkout with local synthetic data. Preserve its business logic and dependency versions, apart from recorded host/plugin wiring and the deliberate validation edits.
- Require at least one useful candidate produced by an existing application workflow, with its callable and application purpose identified. Candidate count alone is not sufficient evidence of usefulness.
- Review synthetic cases explicitly, replay accepted cases offline, apply and verify a behavior-preserving edit, then apply a targeted output regression and require the expected verification failure. Restore validation edits afterward.
- Verify no fresh native effect reads occur during offline replay and preserve invocation-level correlation between explicit arguments, recorded external values, and completion.
- Assert automatic process cleanup and discovery-state cleanup at the end. Distinguish recording completion, workflow completion, candidate production, review, replay, regression detection, and cleanup in the evidence.
- Preserve previous pilot artifacts unchanged. A zero-candidate or manually cleaned-up run cannot satisfy this journey's acceptance requirement. If support remains insufficient, publish the measured blocker and keep this requirement unresolved.

## Testing Decisions

Confirmed testing boundaries:

- Use the existing public CLI plus a real Vite/HTTP host as the primary behavioral seam. Assert exit status, session artifacts, listener reachability, discovery cleanup, and survival or termination of explicitly owned processes. Avoid tests coupled to helper names or signal-call counts.
- Extend existing launch, attach, recovery, middleware lifecycle, browser stop-acknowledgement, and controller reset integration tests. Include a launched descendant that ignores graceful termination, startup failure after spawning a descendant, repeated interruption, externally stopped recording, and an unrelated listener that must survive. Prove test cleanup itself cannot conceal a leaked process.
- Use existing scan/session-report outputs for the capture inventory. Use existing adapter, transform, and offline replay acceptance journeys only when a narrowly scoped change needs additional regression coverage.
- Use the existing packed-consumer/public-pilot boundary for the useful application journey. Seed a known regression as a positive control; require the expected behavioral diagnostic rather than merely any nonzero exit.
- Use the explicit development benchmark for latency. Verify the comparison tool rejects missing pairs and a known over-budget control; never make noisy wall-clock thresholds ordinary unit tests.
- Finish with the supported Node 22 toolchain, type checking, the locked acceptance suite, packed-consumer verification, and an isolated final application run. Verify artifact and runner digests after source changes stop.

## Out of Scope

- Arbitrary closure serialization, stateful returned-object replay, and silently omitting function-valued properties.
- New framework-language integrations, general-purpose I/O interception, new effect providers, workspace support, and runtime compatibility expansion.
- Automatic expectation approval or claims that characterization cases prove business correctness.
- Package publication, hosted telemetry, changes to application dependencies to manufacture compatibility, or human review-time measurements without a participant.
- Claiming an application journey succeeded because its evidence schema validated, its pages rendered, or controlled fixtures passed.

## Further Notes

The user confirmed the CLI/Vite integration, packed-application pilot, and explicit latency-benchmark testing boundaries. This spec is ready for ticket decomposition. The proposed cleanup bound, inventory size, and measurement count are concrete planning defaults introduced by this spec, not previously measured results.

Acceptance is four separate outcomes: bounded owned-process cleanup; a ranked useful-capture decision; paired browser latency evidence and a proposed budget; and an unattended real application characterization journey. Preserve unmet outcomes explicitly rather than closing the entire effort on a blocked pilot.
