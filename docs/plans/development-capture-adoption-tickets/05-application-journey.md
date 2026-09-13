# 05: Prove an unattended application characterization journey

## Parent

https://github.com/adammedford/replay-lock/issues/65

## What to build

Use the recommended existing workflow and final packed library to demonstrate useful capture, explicit review, offline replay, refactor survival, seeded regression detection, and automatic cleanup.

## Acceptance criteria

- [ ] Install the final packed library in the selected pinned application with local synthetic data, recording package, runner, source, and lockfile digests.
- [ ] Preserve application dependencies and business logic apart from documented integration wiring and temporary validation edits.
- [ ] Run an existing workflow and retain at least one useful candidate; identify the callable and the application behavior it protects.
- [ ] Explicitly review synthetic candidates and replay accepted cases offline without fresh native effect reads, preserving argument/effect/completion correlation.
- [ ] A behavior-preserving edit passes replay; a targeted behavioral regression fails with the expected diagnostic rather than merely a nonzero exit. Restore validation edits.
- [ ] Run unattended and assert owned descendants/listeners and discovery metadata are cleaned up; any manual termination disqualifies success.
- [ ] Record workflow, recording, candidate, review, replay, regression, and cleanup outcomes separately. Preserve historical pilot artifacts.
- [ ] If the capture decision finds a required capability outside this spec, leave this ticket blocked and link its separately scoped follow-up; zero candidates or valid evidence alone cannot satisfy completion.
- [ ] Finish with Node 22 type checking, the locked acceptance suite, packed-consumer verification, and the isolated final pilot against unchanged final artifact identities.

## Blocked by

- https://github.com/adammedford/replay-lock/issues/67.
- https://github.com/adammedford/replay-lock/issues/68.
