# 01: Stop launched development servers without stopping attached servers

## Parent

https://github.com/adammedford/replay-lock/issues/65

## What to build

Make ordinary recording shutdown complete through the public command, preserving completed observations and releasing every process and listener owned by the launch. Reproduce the observed controller/pilot/npm shutdown race before choosing the fix; incorporate any lifecycle prefactoring into this verifiable slice.

## Acceptance criteria

- [ ] Reproduce the detached npm descendant observed in the Epic pilot with a deterministic CLI integration fixture and document the causal sequence.
- [ ] Normal stop and externally completed recording await graceful shutdown of owned launched descendants and remove discovery metadata before reporting cleanup success.
- [ ] Attach-mode stop leaves the externally owned application and an unrelated listener running.
- [ ] Completed observations remain available for review and offline replay; existing missing-acknowledgement diagnostics remain intact.
- [ ] The pilot waits for controller shutdown rather than interrupting it prematurely, and records cleanup completion as a separate outcome.
- [ ] Existing public CLI/Vite and packed-consumer tests pass without relying on signal-call counts or test teardown to conceal leaks.

## Blocked by

None (can start immediately).
