# #127: ordinary verifier attachment controls

Status: retained partial attachment feasibility, not transformed-byte qualification
or complete G1B. Baseline `8f9ae72746c822e04cb3606850737fea91a10a6f`.
The user approved evaluation of the fixed pinned recipe/private attachment
candidate. This first slice follows the attachment-first sequence in
[the proposal](constrained-import-evaluated-binding-next-step.md).

## What ran

Two new acceptance tests use the existing owned fixture and ordinary CLI verifier.
Each naturally records result7 through HTTP or a real Chromium button, inspects
the actual complete pending candidate, explicitly reviews it and runs normal
isolated verification. No observations are fabricated or negatively accepted.
The generated Browser Mode fixture config is fixed before recording; controls do
not rewrite it between review and verification.

For each reviewed case, three private replay controls use the unchanged CLI:

| Control | Ordinary isolated Node | Ordinary Browser Mode |
| --- | --- | --- |
| Release unchanged output | exit0, verifies result7 | exit0, verifies result7 |
| Mutate helper's literal3 to4 after transformation | exit1, OUTPUT_MISMATCH | exit1, OUTPUT_MISMATCH |
| Refuse entry representation | exit2, EVALUATED_INPUT_REFUSED, no OUTPUT_MISMATCH | exit2, EVALUATED_INPUT_REFUSED, no OUTPUT_MISMATCH |

Both mutation tests first went red against an unattached/no-op control: the
verifier still exited0 instead of observing the mutation. They pass after actual
attachment. Mutation deliberately reaches unchecked evaluation and produces an
ordinary mismatch; this independently establishes reachability, **not prevention**.
Explicit refusal is a separate mode, not a qualified-output mutation detector.

## Actual attachment and pins

The fixture-only preload patches the installed VitestModuleEvaluator's
runInlinedModule in the ordinary CLI and its isolated descendants. It neither
replaces the verifier nor changes dependency files or the parent process. The
private internal evaluator source is SHA256-pinned to
`a0b36fb2211d2587d8df68d5855d48141be27e99bdb973378a83f927e03b004e`.
The preload and client hook check Vite8.2.2, Vitest4.1.11 and
@vitest/browser4.1.11 metadata. These checks are compatibility guards, not a
trusted complete transform inventory or atomic package identity proof.

The fixed fixture config attaches only in test mode with an explicit private
control environment. It wraps the real Browser Mode server client environment's
transformRequest result, after plugin transforms. Entry refusal happens before
that response is returned to the browser; mutation changes that actual result.
This is not a claim about exact HTTP response bytes: Vite response decoration,
304/direct cache paths, module promise reuse and alternate delivery routes remain
unqualified. The Node hook similarly precedes Vitest's wrapper/vm execution but
does not cover native imports, builtin shortcuts, mocked/cache paths or every
transport route.

The launcher admits only the fixed synthetic fixture root/name, refuses inherited
NODE_OPTIONS, bounds captured diagnostics to1MiB and kills its own process group
after45seconds on this POSIX host. Windows child-only cleanup is unverified;
neither mechanism is a malicious-process sandbox. Test ceilings remain60000ms.

## Limits and next work

No new live final-byte ownership is established: the existing live owner still
supplies authored snapshot strings. Neither replay hook independently rebuilds
and qualifies the fixed trusted transform recipe or binds a whole executable
closure. There is no final-code equality refusal, complete caps accounting,
warm/cold bypass matrix, native-effect oracle or mid-turn provenance proof.
No arbitrary plugin/application effect is admitted. Effect permissions,
operation-boundary timing, artifacts/profiles/schemas and public APIs stay fixed.

Next implement the finite recipe reference and live/replay binding at these
actual hosts, then refute late-output mutation by explicit qualification refusal
rather than an ordinary mismatch. Keep independently reachable mutation controls.
Do not infer G1B from digest equality or these reachability tests. #106 stays open;
#107 stays blocked. No production PR/merge or application restoration/execution.
The incomplete pinned application is untouched; its earlier revalidation
limitation remains unresolved, not an unchanged-baseline claim.

## Verification

Focused Node and Chromium control tests passed after their recorded red controls.
Final single-file/full-suite/typecheck and independent review results will be
recorded after they complete; prior full-suite evidence is not reused as current.
