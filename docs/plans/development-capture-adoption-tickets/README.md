# Development capture adoption: proposed tickets

Parent spec: https://github.com/adammedford/replay-lock/issues/65

Approved tickets published with `ready-for-agent`. GitHub native blocking links are authoritative; each issue body also names its blockers.

| Draft | Deliverable | Blocked by |
|---|---|---|
| [01: #66](https://github.com/adammedford/replay-lock/issues/66) | Reliable normal shutdown, preserving attached servers | None |
| [02: #67](https://github.com/adammedford/replay-lock/issues/67) | Bounded cleanup on interruption and failure | 01 |
| [03: #68](https://github.com/adammedford/replay-lock/issues/68) | Ranked capture opportunity and application choice | None |
| [04: #69](https://github.com/adammedford/replay-lock/issues/69) | Paired browser latency evidence and proposed budget | 02 |
| [05: #70](https://github.com/adammedford/replay-lock/issues/70) | Unattended real application characterization journey | 02, 03 |

Tickets 01 and 03 can begin independently. Ticket 04 needs reliable repeated cleanup, but its workload can use the existing pinned Epic application; it does not depend on the capture selection. Ticket 05 does not depend on performance measurement. Benchmark and final pilot runs must be scheduled without competing workloads even when their implementation can proceed independently.

Any lifecycle prefactoring belongs in ticket 01 with a passing end-to-end shutdown demonstration. No separate horizontal refactor is needed from the available evidence. Unknown capability expansion is not represented as an implementable ticket: ticket 03 must identify it concretely first, and ticket 05 remains blocked if the selected journey requires it.
