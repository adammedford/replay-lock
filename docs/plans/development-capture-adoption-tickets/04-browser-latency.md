# 04: Measure recording overhead during browser load, navigation, and HMR

## Parent

https://github.com/adammedford/replay-lock/issues/65

## What to build

Extend the explicit development benchmark to deliver paired enabled/disabled measurements of real application responsiveness, with a justified proposed latency budget and a machine-readable comparison rule.

## Acceptance criteria

- [ ] Use an isolated pinned application and equivalent host/plugin wiring for enabled and disabled recording; reuse the known Epic workload unless another choice is justified.
- [ ] Measure cold page load, existing navigation, and edit-to-visible-update latency through browser-visible completion, not only transform duration.
- [ ] Define cache preparation and warm-up policy before runs; collect at least five alternating pairs on the same host without concurrent verification or other pilots.
- [ ] Retain raw samples, timeout/failure outcomes, environment and artifact/runner/source identities; report absolute and relative overhead alongside medians.
- [ ] Identify the dominant measured overhead with temporary profiling, then remove instrumentation and restore edits before final measurements.
- [ ] Propose a development-latency budget and implement its explicit comparison rule; reject missing pairs and a known over-budget control.
- [ ] Keep timing thresholds outside ordinary correctness CI and make no retrospective claim that the earlier synthetic benchmark measured browser latency.
- [ ] Verify automatic cleanup between pairs; no manual intervention may be hidden in a successful benchmark run.

## Blocked by

- https://github.com/adammedford/replay-lock/issues/67.
