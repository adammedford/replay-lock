# 02: Record declared external calls, proven on `useIsPending`

## Parent

[declared-external-calls.md](../declared-external-calls.md)

## What to build

Implement `effects.external` end to end, proven first on one browser callable: `useIsPending` in Epic's `app/utils/misc.tsx`. It computes whether a form submission is pending from two router hook reads, `useFormAction()` and `useNavigation()`. The search bar calls it on the pilot's existing user-search workflow.

1. **Measure first.** Add a report-only `yield:dev --external <spec>` option and confirm `useIsPending` becomes eligible with `react-router#useFormAction` and `react-router#useNavigation` declared.
2. **Analysis.** Declared calls, including member chains, no longer produce unknown-call, unknown-module or initialization blockers. Function arguments and non-call uses of a declared binding keep their current codes. A declared call inside uninstrumented code stays `UNINSTRUMENTED_EFFECT`.
3. **Transform and runtime.** Wrap declared calls in every instrumented module with the existing traced-effect path. Record arguments and results with the value codec, and raise `MUTATED_INPUT` on changed arguments.
4. **Replay.** Rewrite imports of declared bindings in every module the replay graph loads to stubs that throw outside an intercepted call. Record the declared operations each case used, and fail with `EXTERNAL_UNDECLARED` when the configuration no longer declares one.
5. **Review.** Label a case whose completion equals one recorded external result as a pass-through, and report the pass-through share.

## Acceptance criteria

- [ ] In the pinned pilot, `useIsPending` produces an accepted case that replays offline. Name the behavior it protects.
- [ ] A behavior-preserving edit passes. At least one mutant is detected with a completion difference: flipping the pending-state comparison, or changing the form method default.
- [ ] A mutant that changes the route id or arguments passed to a declared hook fails with `TRACE_MISMATCH`.
- [ ] Hazard fixtures fail with their named codes:
  - a declared call given a callback;
  - an argument-mutating declared call;
  - a declared call returning an object with methods;
  - a declared binding used as a value;
  - a stub touched outside a call;
  - a case whose operation is no longer declared.
- [ ] Browser latency stays within `docs/pilots/responsiveness-budget.json`. Report how often the hook is recorded per navigation, including StrictMode double renders.
- [ ] `docs/development-recording.md` documents declared external calls, their refusals and the new codes.
- [ ] The full gate passes.

## Blocked by

- [01](01-analyzer-precision.md)

**Gate:** after this ticket, stop and review the evidence with the user before starting 03.
