# #127: ordinary verifier attachment controls

Status: retained partial attachment feasibility, not transformed-byte qualification
or complete G1B. Baseline `8f9ae72746c822e04cb3606850737fea91a10a6f`.
The user approved evaluation of the fixed pinned recipe/private attachment
candidate. This first slice follows the attachment-first sequence in
[the proposal](constrained-import-evaluated-binding-next-step.md).

## What ran

Two new acceptance tests use the existing owned fixture and ordinary CLI verifier.
Each naturally records result 7 through HTTP or a real Chromium button, inspects
the actual complete pending candidate, explicitly reviews it and runs normal
isolated verification. No observations are fabricated or negatively accepted.
The generated Browser Mode fixture config is fixed before recording; controls do
not rewrite it between review and verification.

For each reviewed case, three private replay controls use the unchanged CLI:

| Control | Ordinary isolated Node | Ordinary Browser Mode |
| --- | --- | --- |
| Release unchanged output | exit 0, verifies result 7 | exit 0, verifies result 7 |
| Mutate helper's literal 3 to 4 after transformation | exit 1, OUTPUT_MISMATCH | exit 1, OUTPUT_MISMATCH |
| Refuse entry representation | exit 2, EVALUATED_INPUT_REFUSED, no OUTPUT_MISMATCH | exit 2, EVALUATED_INPUT_REFUSED, no OUTPUT_MISMATCH |

Both mutation tests first went red against an unattached/no-op control: the
verifier still exited 0 instead of observing the mutation. They pass after actual
attachment. Mutation deliberately reaches unchecked evaluation and produces an
ordinary mismatch; this independently establishes reachability, **not prevention**.
Explicit refusal is a separate mode, not a qualified-output mutation detector.

## Actual attachment and pins

The fixture-only preload patches the installed VitestModuleEvaluator's
runInlinedModule in the ordinary CLI and its isolated descendants. It neither
replaces the verifier nor changes dependency files or the parent process. The
private internal evaluator source is SHA256-pinned to
`a0b36fb2211d2587d8df68d5855d48141be27e99bdb973378a83f927e03b004e`.
The preload and client hook check Vite 8.2.2, Vitest 4.1.11 and
@vitest/browser 4.1.11 metadata. These checks are compatibility guards, not a
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
NODE_OPTIONS, bounds captured diagnostics to 1 MiB and kills its own process group
after 45 seconds on this POSIX host. Windows child-only cleanup is unverified;
neither mechanism is a malicious-process sandbox. Test ceilings remain 60000ms.

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

Runtime implementation pin: `fab1073e69354999c0d3c49b1be25840e03656a7`.
Node 22.19.0/npm 11.5.2 with a writable fixture cache:

- Focused Node/Chromium attachment controls: 2/2 passed after recorded red controls.
- Entire owned-turn acceptance file: 8/8 passed, with 60000ms test ceilings.
- `npm run typecheck`: passed. JavaScript prototypes are not TypeScript-checked.
- Full unweakened `npm run verify`: exit 0, verification suite passed, including
  runner/coverage regressions, package contract, packed consumer and all locked
  acceptance files with serial browser execution. No tests/manifests were removed.
- `git diff --check`: passed.

Post-full-suite driver recheck of both attachment controls: 2/2 passed. Runtime
and test sources remain byte-identical to the reviewed implementation pin.

Independent four-pass Standards review of `8f9ae72...fab1073`: zero actionable
findings. Independent four-pass Spec review: zero actionable mismatches for this
attachment-only slice; full recipe and both-host execution-route proof remain
unmet. Driver reread both reports and the critical attachment boundaries. These
are source reviews, not independent runtime/native-effect qualification.

Primary main remains clean at `0867957626ba7a0869fe1fa2753ec311afee60d0`.
No application/config/dependency restoration or execution, production PR/merge,
effect relaxation, public API or persisted profile/schema change occurred.
