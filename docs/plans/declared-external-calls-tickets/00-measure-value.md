# 00: Measure whether captured cases detect regressions

## Parent

[declared-external-calls.md](../declared-external-calls.md)

## What to build

Make the blockers report and the pinned pilot measure value instead of eligibility.

**Blockers report (delivered with the spec).** `scripts/yield-blockers.mjs` classifies each `UNSUPPORTED_CALLABLE` and `UNSUPPORTED_ASYNC` blocker by the construct at its root.
- Outside supported shapes: JSX, classes, generators, tagged templates, `arguments`, and functions nested in anonymous functions or methods. These callables leave the unlock plan.
- Ordinary blockers that enter the plan: an `await` on an unanalyzed call, a non-`const` binding, and a non-literal default.
- Result on Epic: outside shapes fell from 232 to 122 (110 JSX); see [epic-blockers-2026-09-24.md](../../pilots/epic-blockers-2026-09-24.md).

**Pilot mutation stage.** After the existing regression stage in `scripts/pilot-dev.mjs`:
- For each accepted callable, generate bounded logic mutants in `scripts/pilot-dev-edit.mjs`: flipped comparison and logical operators, swapped conditional branches, changed string and numeric literals.
- Apply each mutant alone, run `verify`, restore, and record `detected`/`total` per callable.
- A callable with no mutable logic is reported as such, not as a pass.

## Acceptance criteria

- [ ] The blockers report's acceptance test covers each construct. Epic's baseline report is regenerated with the application's configuration; the 2026-09-23 report is preserved.
- [ ] Mutant generation is a tested pure function: each operator and branch mutant, the literal mutants, no mutants for a callable without logic, and other functions left unchanged.
- [ ] The pilot report schema moves to version 2 with per-callable mutation results. `validatePilotReport` still accepts the committed version 1 evidence unchanged.
- [ ] A pinned Epic pilot run records mutation results for every accepted callable. Commit the evidence with a short note on what the current accepted cases protect.
- [ ] `humanReviewMs` stays null for scripted review. One review session with the user as participant records review time per case and sets the ceiling the gate in the [README](README.md) uses.
- [ ] Node 22 type checking, `npm run verify` and the packed-consumer check pass.

## Blocked by

None.
