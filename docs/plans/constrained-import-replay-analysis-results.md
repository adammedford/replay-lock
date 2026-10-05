# #127: private post-preflight replay analysis input slice

Baseline `da444839344e235e0dcd235aee06bd67ed101d48`. This continues the
[live input experiment](constrained-import-sealed-analysis-results.md) on the
retained branch. It is a prerequisite of the
[recipe sequence](constrained-import-recipe-next-step.md), not final executable
binding, complete replay input ownership, production support or full G1B.

## Phase boundary and finite trust

The private ordinary-CLI launcher optionally installs a narrowly pinned preload.
Only the six-file synthetic workflow with its exact generated owned-turn
configuration is accepted. Configuration is checked before the ordinary loader
can run it; application qualification is deliberately not moved into that early
check. This guard uses successive bounded physical reads, not atomic acquisition
or protection against hostile concurrent configuration replacement.

The three pinned analysis modules receive a phase-aware filesystem facade.
Before activation it delegates to physical filesystem operations. Parent CLI and
isolated validation/replay worker preflight therefore remain physical. An exact
loaded-source rewrite activates the snapshot only after the replay worker's
`await preflightDevCases(...)` returns. Validation workers never activate it.
Each replay process captures fresh inputs, qualifies the complete two-source
fixture closure using the existing conservative placement grammar, checks
currentness again and transitions once into a retained input view. No live
snapshot is reused for replay. The initial configuration-check snapshot is also
discarded rather than used as replay authority.

After activation, selected analyzer/cache/transform filesystem calls have no
ambient fallback. The shared finite projection retains file text, metadata,
directory membership and known direct-child absences. Unknown deeper/outside
access latches refusal even if analysis catches the error. Checks immediately
after replay analysis and instrumentation prevent a caught refusal from returning
success. A later physical preflight in that process also latches refusal instead
of silently running against retained logical stats. This latch and the closed
phase are source-reviewed, not separately proved by a public late-access probe.

Loaded pins cover the three analysis modules and verifier; they are not a complete
transitive toolchain identity. The existing live worker adapter now uses the same
projection factory, with its existing diagnostic unchanged. No production source,
global filesystem builtin, dependency file, public API, profile or schema changes.
The existing evaluator attachment remains private trusted infrastructure; this
slice does not expand its claims into an executable qualification proof.

## Public evidence and diagnostic limitation

Node HTTP and Chromium button calls naturally observe 7. Tests stop recording,
inspect each complete pending candidate, explicitly review it, then launch the
ordinary offline CLI. With the private release hook enabled, both reviewed realms
verify successfully. Its refusal control throws `REPLAY_ANALYSIS_REFUSED` at the
post-preflight boundary, with exit 2 rather than `OUTPUT_MISMATCH`.

An unsafe physical helper initializer is rejected as `GRAPH_REFUSED` before that
control, with the same result from the unmodified ordinary verifier. No synthetic
initializer log marker appears. This is compatibility evidence for the existing
refusal, **not** an independently latched native-effect prevention oracle.

The originally proposed assertion that this helper edit would yield physical
`REPLAY_SAFETY_REGRESSION` was wrong. `loadDevConfiguration` creates a Vite server
before the CLI reaches `preflightDevCases`; the fixed fixture generation plugin
qualifies source during `configResolved` and rejects the initializer first.
A trial unsafe-callable edit also hit that earlier gate. Those failed assertions
were not counted as successful safety evidence. This slice does not reorder the
CLI, weaken that gate or manufacture accepted artifacts to reach preflight.
The explicit C2 diagnostic requirement remains unproved at this fixture's public
seam; source review can establish only that the later preflight's reads stay
physical. The local original diagnostic gate is recorded as a handoff, not met.

The initial Node test failed with the new launcher option ignored: ordinary
verification returned 0 where the refusal assertion required 2. A deliberately
disabled-preload browser control is also checked before restoring the mechanism.
These controls measure boundary activation, not immutable replay behavior under
late physical drift. No drifted observation is accepted. Existing live drift
regressions remain in the same locked, serial-browser acceptance file, with the
unchanged 60000ms per-test ceilings.

## Remaining work

Independent per-realm recipe construction, final code/maps/delivery binding,
configuration/options ownership across phases, coherent acquisition, full
transitive inventory, unknown-access and late replay-drift runtime probes,
cache/native/extra-entry coverage, closure semantics, lifecycle, provenance and
boundary/performance workloads remain unfinished. Input sealing and a deliberate
startup refusal alone do not satisfy those obligations. No new eligibility gain
or full G1B success is claimed. #106 remains open; #107 remains blocked.

No pinned application restoration/edit/execution, effect relaxation, package
exception, production PR or merge is selected.

## Verification and independent review

Implementation `585b7b7126c9e56b1556fc2256bb13d2d5fe9fa0` passed the unchanged
`npm run verify` with Node22.19.0/npm11.5.2, including coverage/runner regressions,
package contract, packed consumer and the complete locked acceptance suite with
serial browser files. No test was removed, ceiling changed or floor weakened.
Final `npm run typecheck` passed; it excludes these private JavaScript scripts.
Separate `node --check` syntax checks passed for all seven changed/new scripts.
The four rebuilt analyzer/cache/transform/verifier SHA-256 pins were remeasured
and matched. This is selected-module identity, not a full transitive audit.

Post-full focused acceptance rerun passed 4/4: live browser 11112ms, replay Node
7467ms, replay browser 8138ms, live Node 6294ms (rounded). Each is below its
unchanged 60000ms ceiling. Node's initial ignored-option red and browser's
disabled-preload red both failed at the expected successful-verification versus
refusal assertion; the restored mechanism passed. The earlier invalid diagnostic
expectations were discarded, documented and left as a handoff, not proof.

Independent four-pass Standards and Spec reviews of `da44483...585b7b7` each
reported zero actionable findings for this bounded prerequisite. The driver
reread their concrete source evidence: the awaited physical preflight placement,
one-way phase/latches, fresh capture and grammar qualification, shared live view
compatibility, ordinary natural workflows and diagnostic limits. Review ledgers
are manual assessments, not machine certification of runtime safety; parent
manual re-verification executed no runnable gate oracles. The original C2
diagnostic gate is abandoned with the explicit handoff above. Full G1B remains
unmet, regardless of this slice's passing tests.

`git diff --check` passed. Primary main remained clean at
`0867957626ba7a0869fe1fa2753ec311afee60d0`; the pinned application was untouched.
No hosted CI pass is claimed. These results are local POSIX evidence, not a
Windows or earlier-Node-patch compatibility claim.
