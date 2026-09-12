# 03: Identify useful existing application callables and the smallest capture opportunity

## Parent

https://github.com/adammedford/replay-lock/issues/65

## What to build

Deliver a ranked, evidence-backed adoption decision beginning with the pinned Epic Stack workflows. Identify useful existing behavior that ReplayLock can characterize, or specify the narrowest capability gap without widening the implementation contract.

## Acceptance criteria

- [ ] Inventory at least ten existing callables across at least two existing workflows, with application purpose, eligibility/exclusion, invocation evidence where available, value portability, and plausible enabling work.
- [ ] Distinguish static exclusion, runtime rejection, lack of invocation, and retention; do not infer execution of an excluded function from a page visit.
- [ ] Explain the timer factory closure limitation without dropping function-valued properties or treating closures as portable values.
- [ ] Rank opportunities by practical value, expected implementation scope, and evidence confidence; prefer existing support and configuration within the current contract.
- [ ] If Epic has no useful supported opportunity, assess and pin another existing application and record the selection rationale without removing Epic evidence.
- [ ] Deliver a concrete workflow/callable recommendation and acceptance checks. If support is insufficient, provide a narrowly scoped follow-up proposal and explicitly identify the blocked application-journey requirement.
- [ ] Keep the evidence value-free where required, preserve privacy checks, and avoid changing business logic or dependency versions to manufacture candidates.

## Blocked by

None (can start immediately).
