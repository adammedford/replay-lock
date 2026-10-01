# Declared external calls: proposed tickets

Parent spec: [declared-external-calls.md](../declared-external-calls.md). Parent issue: [#104](https://github.com/adammedford/replay-lock/issues/104). Tickets are published with `ready-for-agent`.

| Draft | Deliverable | Blocked by |
|---|---|---|
| [00: #105](00-measure-value.md) | Blockers report classifies constructs; pilot scores accepted cases against logic mutants | None |
| [01: #106](01-analyzer-precision.md) | Analyzer precision fixes and a replay environment for module initialization | 00 |
| [02: #107](02-declared-calls-browser-tracer.md) | Declared external calls end to end, proven on `useIsPending` in the browser realm | 01 |
| [03: #108](03-node-tracer-profile-loader.md) | Destructured parameters, `Response` values and V2 trusted packages, proven on the profile loader | 02 |
| [04: #109](04-auth-and-requests.md) | Request encoding, argument references and request body reads, proven on authenticated workflows | 03 |

Each ticket names the Epic callables it must capture and the behavior they protect.

**Gate.** Stop and bring the evidence to the user after 02 and after 03 before starting the next ticket, even when automated checks pass. These are explicit user-review checkpoints in the individual tickets, not permission to widen automatically. In particular, surface any of the following:
- a seeded mutant in a named callable goes undetected;
- review time per accepted case exceeds the ceiling set in 00;
- the browser latency budget fails;
- the named callables cannot be captured without a capability outside the ticket.

Ticket 00 also remains a hard prerequisite for 01 until a real participant review session records per-case timings and the user's ceiling. Use the [separate human-review evidence workflow](../../pilots/human-review.md); scripted pilot reports retain null human timings.

Deferred until a ticket's evidence requires them:
- trust for further deterministic libraries (`clsx`, `tailwind-merge`, `cookie`);
- result projection for large hook results;
- opaque values passed between declared calls;
- `console` as a declared write.
