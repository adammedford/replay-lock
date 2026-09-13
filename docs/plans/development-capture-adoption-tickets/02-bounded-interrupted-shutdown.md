# 02: Bound cleanup after interrupted startup and unresponsive descendants

## Parent

https://github.com/adammedford/replay-lock/issues/65

## What to build

Extend the owned lifecycle to interruption and failure so recording cannot leave descendants running or wait indefinitely. Preserve the distinction between owned launch and attachment throughout shutdown.

## Acceptance criteria

- [ ] Startup failure after spawning a descendant, SIGINT/SIGTERM, repeated interruption, and a child that ignores graceful termination are covered by public-command integration tests.
- [ ] Once shutdown begins, the complete cleanup path is bounded to 15 seconds: up to 10 seconds graceful termination followed by bounded escalation and exit confirmation.
- [ ] Signal handling remains effective until cleanup completes; cleanup is idempotent when stop, child exit, and failure overlap.
- [ ] Escalation targets only ownership established by the launch; it never selects processes by shared ports or broad names and never kills an attached application.
- [ ] Cleanup failure is visible in command results and pilot evidence; it cannot be reported as an unattended success.
- [ ] Sealed observations remain recoverable and incomplete captures remain partial.
- [ ] Confirm supported-platform behavior explicitly; distinguish POSIX evidence from other platforms and do not expand runtime compatibility claims.

## Blocked by

- https://github.com/adammedford/replay-lock/issues/66.
