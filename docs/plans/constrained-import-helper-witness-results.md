# #127: fixed Node helper-only delegate witness

Retained, non-production continuation of [pre-release integrity](constrained-import-prerelease-integrity-results.md),
based on `00b9da7`. The user's `continue` followed the explicit helper-only witness
approval question. The driver stated that interpretation before implementation.
This authorizes the selected private witness, not production or native effects.

## Selected dispatch and preserved prefix

Private `evaluatorWitness:'helper'` is admitted only with the existing final Node
guard and staged Node adapter. `false` retains ordinary execution; `true` retains
the first-delegate witness. Unknown modes and unstaged selective placement refuse
before fixture admission. The ordinary HTTP diagnostic remains
`SYNTHETIC_EVALUATOR_DELEGATE_REACHED`; no new taxonomy/endpoint/counter is added.

The original inline wrapper retains its code, context, module and evaluator
receiver. On original delegation it supplies the actual module node's id to the
trusted marker check. The helper selection compares that id with the independent
frozen helper declaration. It does not learn an expected id from actual output.
External delegation does not supply an inline id, so the selective mode permits
the declared trusted observer route. Its original evaluator/native import remains
unchanged; no plugin or native stage is disabled or reordered.

Complete collection/qualification still precedes release. The existing stager
enforces ordinary entry → observer → helper demand. Thus reaching the selected
helper branch is consistent with checked entry and observer delegation before it.
The marker throws immediately before the original helper evaluator call. There
are **no private counts or separate prefix initializer/effect oracles**: placement
and the prefix are corroborated by pinned source and independent review, not a
new external execution-count assertion. Entry has begun, not completed; native
import can reuse a cached namespace, so fresh observer initialization is not
proved. This is not zero prior graph execution, zero infrastructure effects,
native/transitive qualification or later-interference prevention.

Primary installed Vite 8.2.2 source:
`node_modules/vite/dist/node/module-runner.js:1228-1273` constructs original
dependency demand/contexts and delegates inline/external evaluation; `:1018-1025`
consumes actual inline contexts and performs native import. Driver reread the
runner source and current disk SHA-256 pins:
`c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92` and node chunk
`f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0`.
Disk compatibility remains distinct from loaded-byte provenance.

## Corruption-probe boundary

Every existing pre-release `stagedControl` now explicitly requires
`evaluatorWitness === true` at workflow and attachment admission. A truthy helper
selection is **not** enough. The prior probes can change entry context or helper
state before release; combining them with a selectively delayed marker could
permit corrupted earlier inputs during a guard-refutation run. Such combinations
must therefore remain refused, even though ordinary checks would normally catch
them. New later-demand controls would need their own explicitly limited placement;
none is added in this slice.

## Public test-first and refutation evidence

The new ordinary HTTP test initially failed on unsupported mode admission
(`ATTACHMENT_CONTEXT_REFUSED`, 0.561 ms), not a failed existing guard. With the
selective branch implemented it passed in 5,570 ms: HTTP409 marker, inspected
zero pending candidates after ordinary stop, host closed in `finally`, no review.
The named startup test separately checks unstaged placement and all four prior
corruption probes reject; unexpected admitted hosts are closed without invoking
the application.

Three temporary source controls refuted those assertions independently:

- Removing only the helper-marker branch made ordinary safe release return
  HTTP200 rather than409 (exit one; 559 ms test, 1,030 ms process). Qualification
  was not weakened and no observation was manufactured or reviewed.
- Replacing strict first-marker identity with truthiness at both admission
  boundaries admitted an incompatible probe: `Missing expected rejection`, exit
  one, 523 ms. Its unexpected host closed without an application request.
- Removing helper-only staged placement at both boundaries admitted an unstaged
  host: same failed rejection assertion, exit one, 527 ms. Also closed without
  invocation. Both boundaries matter; a remaining duplicate safeguard would still
  reject and would not refute the shared admission rule.

All controls were immediately restored. The restored focused set passed 8/8,
zero failures/skips, in 78,528 ms aggregate: helper witness 5,506 ms; admission
policy below1 ms; natural recording/review/verify 17,603 ms. Existing first-marker,
late-drift, context and pre-release probes remain unchanged. Each test retains
its existing 60,000 ms limit; aggregate time is not that per-test limit.

Final unchanged full/affected regression and independent Standards/Spec evidence
belongs in [the scoped manual ledger](constrained-import-helper-witness-gates.md).
Independent read-only Standards and Spec reviews of `00b9da7...5c9e628` found
zero actionable findings. Both checked the selective dispatch placement, preserved
original delegation, duplicated startup safeguards and evidence limitations.
Neither reviewer independently reran the runtime checks.
The unchanged full `npm run verify` completed with exit zero: tooling and runner
regressions, package contract, packed consumer and complete acceptance manifest.
The standalone affected file then passed 16/16 with zero failures, skips or
cancellations in 180,055 ms. Helper witness took 5,507 ms, admission policy below
1 ms, and natural staged recording/review/verify 17,568 ms. Final typecheck, syntax
checks of all three changed JavaScript files and diff check passed. All four
scoped manual gates are met; none is abandoned. Main remains clean at
`0867957626ba7a0869fe1fa2753ec311afee60d0`.
Typecheck passed but excludes these private JavaScript files. Natural witness-off
7/8/refusal, inspected explicit review and ordinary offline verification remain
separate; the private live witness is not installed by offline replay.

Next bounded use: a specifically placed helper-only interference probe after the
checked prefix, with refusal before helper dispatch and a specific guard bypass
making the selected marker reachable. Its result must report permitted earlier
delegation rather than whole-graph zero evaluation. Native loaded/transitive
provenance, browser/replay final barriers, general lifecycle/cache/interference,
full G1B and C2 remain open. No production PR/merge, effect permission, eligibility,
API/schema/profile/dependency/application changes or pinned-application gain.
#106 remains open; #107 blocked.
