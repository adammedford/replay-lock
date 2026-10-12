# #127: retained evaluator-context identity frontier

Source-only research on 2026-10-12 against retained base
`35b87d14872c4bbe447ab603dc984e95c31ed112`. The driver is concurrently testing a
private witness-only control; this note reports no runtime result. No host,
application, build, test, install, commit or GitHub write was performed by this
research task. Full G1B remains open.

## Recommendation

Take one bounded slice: **reject equal-content replacement of the actual retained
entry evaluator's exports context slot before release**, using the already
approved ordinary-HTTP delegate witness. Keep the replacement confined to that
witness-enabled private fixture. The control must never run an original evaluator
with substituted exports, manufacture an observation, or replace the ordinary
unchanged recording/review path.

The source supports a concrete gap, not merely missing adversarial coverage:
`current(record)` checks module exports by identity but deep-compares context
descriptors. An independently allocated, descriptor-equivalent object substituted
only into `context.__vite_ssr_exports__` can pass both checks. The evaluator later
reads that context slot, whereas `directRequest` returns its originally captured
exports object. The proposed repair must bind retained top-level context values by
identity, rather than treating structural equivalence as continued ownership.
Sources: [stager at the retained base](../../scripts/prototype-import-staged-node-release.mjs),
base lines 43–60; installed Vite sources S1–S3 below.

## Inspected primary sources

All installed Vite references below are under the exact inspected root
`/Users/adammedford/Projects/replaylock-reference-127/node_modules/vite/`.
The package is **8.2.2**, `package.json:3`. File hashes were independently reread
during the source investigation:

| Installed file | SHA-256 |
| --- | --- |
| `dist/node/module-runner.js` | `c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92` |
| `dist/node/chunks/node.js` | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |

These match the existing attachment pins. They identify current disk source, not
the exact previously loaded bytes, a reproducible native build or a complete
executable inventory. [Attachment](../../scripts/prototype-import-live-attachment.mjs),
base lines 19–28; [native evidence limitations](constrained-import-native-runtime-results.md),
lines 44–59.

- S1: [installed module runner](../../node_modules/vite/dist/node/module-runner.js),
  line 725 declares the actual `__vite_ssr_exports__` and other context keys;
  lines 1020–1021 read those slots as arguments to the original `AsyncFunction`
  and seal the context's exports object after completion.
- S2: same source, lines 1244–1249 allocate the original null-prototype exports
  object, give it its `Symbol.toStringTag` descriptor, and assign it to
  `mod.exports`. Lines 1261–1272 construct the six evaluator context slots;
  exports helpers close over the original exports object. Line 1273 awaits the
  evaluator and returns the original local exports object.
- S3: same source, lines 1170–1183 store and await the original node promise,
  including cache/cycle paths. Lines 1228–1237 create ordinary dependency demand
  and perform external evaluator delegation. Lines 1018–1025 distinguish inline
  original evaluation from native `import(filepath)`.
- S4: same source, lines 265–282 define mutable module nodes and graph maps;
  lines 290–328 implement by-id/by-URL lookup, node creation and invalidation.
  `invalidateModule` clears metadata, map, promise, exports and imports. Lines
  345–356 clear maps and normalize native file URLs to node ids.
- S5: [installed SSR loader](../../node_modules/vite/dist/node/chunks/node.js),
  lines 11837–11848 attach Vite's runner before ordinary import; lines
  11859–11883 use no HMR and preserve the original subclass request/result/error
  path. These are private pinned internals, not a new supported public API.

Repository and issue sources: [staged results](constrained-import-staged-node-results.md),
lines 9–61 and 63–114; [release-barrier design](constrained-import-release-barrier-research.md),
lines 37–53 and 66–90; [#127 spec](https://github.com/adammedford/replay-lock/issues/127)
and [latest completed staging record](https://github.com/adammedford/replay-lock/issues/127#issuecomment-6111916951).
The issue's testing decisions require existing public seams and discussion before
additional observable seams; the separate delegate-witness approval is recorded
in [the witness results](constrained-import-delegate-witness-results.md).

## What is guarded, and what is not

At base `35b87d1`, stager lines 38–60, 62–79, 81–122:

| Retained thing | Existing check | Important boundary |
| --- | --- | --- |
| Runner/evaluator and patched dispatch functions | Object/function identities and not closed | Does not bind every runner method, option or graph owner |
| Canonical module | By-id and by-URL lookups return the exact node; id/URL match | Does not freeze all graph maps or their methods |
| Fetch metadata | Same object and deep equality to an independent snapshot | Metadata checks are not arbitrary object/closure immutability |
| Direct-request promise | Exact original `mod.promise` | A new cache/request promise cannot substitute for it |
| Pre-activation module exports | Same object and not evaluated | Does not independently bind the context exports slot |
| Evaluator context | Same retained context reference; descriptor deep equality | Equal-content object replacement and nested in-place mutation are distinct gaps |
| Code/delegate | Exact post-control immutable string and original receiver held by closure | Freezing a record cannot freeze everything captured by closures |
| Requests | Fixed URL/importer/callstack, no dynamic demand, fixed activation order, once only | No proof for cycles, diamonds, re-exports or arbitrary graphs |

The particular context gap does not need an exotic accessor, plugin or unsafe
application initializer. Clone the entry exports object's own descriptors and
prototype, assign the clone to the actual context slot, and leave `mod.exports`
untouched. The top-level descriptor's flags and structurally compared value remain
equivalent; module exports identity still matches. Yet S1 would supply the clone
to original evaluation, while S2's helpers/local return remain tied to the old
object. This is an inference from the explicit source paths; this research does
not execute that inconsistent state.

## One coherent implementation and public verification slice

1. Add one closed private fixture control after all three declared inputs arrive,
   before the final complete-set `current(record)` loop. Mutate only the actual
   entry context exports slot, not the independent reference or a fetched copy.
   Require staging and the existing witness option before the fixture opens.
   The driver's current name is `stagedControl: 'replace-entry-exports'`.
2. First run the ordinary HTTP baseline/control expectation red: unchanged input
   reaches `SYNTHETIC_EVALUATOR_DELEGATE_REACHED`; the replacement must return
   `EVALUATED_INPUT_REFUSED` before that marker. Neither witness case can invoke
   the original evaluator or produce/review a candidate. Zero pending candidates
   is a cleanup assertion, not a replacement for the marker distinction.
3. Repair retained context checking with exact identity for every captured
   top-level data-descriptor value, while retaining key/descriptor-shape checks.
   Do not deep-freeze Vite exports or substitute a new context/namespace. This
   fixes context-slot replacement, not nested mutation or malicious getters.
4. Refute by temporarily removing only the new context-value identity check:
   the same replacement must regain the marker. Restore immediately. If another
   check already refuses, the control is not a specific refutation of this fix;
   inspect the real boundary before claiming coverage.
5. Preserve the unchanged witness-off natural 7, original unguarded late 8,
   guarded late refusal, candidate inspection, explicit review and ordinary
   offline verify controls. Rerun unchanged verification and independent review,
   retaining the existing 60-second per-test ceiling and serial browser policy.

The existing ordinary-HTTP witness/result/candidate seams already express these
assertions: [workflow](../../scripts/prototype-import-workflow.mjs), base lines
199–213; [affected public acceptance](../../test/acceptance/prototype-import-sealed-analysis.test.mjs),
base lines 118–179. A private injection option is not a new observable diagnostic,
application permission or production interface. This slice is therefore a
candidate within the approved retained experiment, subject to the driver's
approval/scope check. Do not silently add a callback that exposes runner records
to application/test code, a new endpoint/counter or a new marker taxonomy.

## Subsequent lifecycle controls and approval boundaries

After the context identity slice, actual helper `invalidateModule`, same-content
metadata-object replacement, canonical map replacement or context import-function
replacement **before release** are meaningful finite controls for existing
guards. Pair each with unchanged marker reachability and a specific guard-bypass
refutation; suppressing only the final loop is insufficient if root cache/demand
paths repeat the same checks. Prefer one class per slice rather than claiming
that a small mutation list proves arbitrary interference. S4 and stager base
lines 43–51, 88–89, 100–122 support these candidate placements.

Mutations at **later helper demand** are different. Entry and the trusted observer
may already have delegated. The current witness always stops at the first entry
delegate, so it cannot simultaneously allow entry and observe later helper
dispatch. Witness-off HTTP refusal/zero candidates can establish late rejection,
but not no prior entry/native execution. An additional selectively armed marker,
dispatch trace/counter, native effect latch or application-visible initializer
oracle would need explicit discussion as an additional observable seam. Exact
checkpoint question: *May the retained fixture add a selectively armed helper
delegate witness through ordinary HTTP, and what prior entry/trusted observer
delegation does that experiment intentionally permit?* Do not bypass this question
by treating an HTTP409 as proof that no module began.

Still-open lifecycle surfaces include nested import-meta/exports mutation,
graph-owner/method substitution, mutable import/importer sets, directRequest or
processImport replacement, arbitrary asynchronous interference, source/load-time
races, and cancellation of underlying operations. The current five-second bounds
supervise transaction promises; they do not cancel arbitrary host fetch/native
operations. The fixed trusted host/no-HMR/closed-routes/owned-turn assumptions are
not hostile-code protection. [Staged limits](constrained-import-staged-node-results.md),
lines 43–61; S2–S5.

## Priority and limits

Fix the exact context-slot identity gap first: it is adjacent to the completed
barrier, cheaply refutable using the already approved witness, and matters even
when code strings are immutable. Then consider a small pre-release invalidation
slice. This does not remove the independent larger prerequisites: native
loaded-byte/transitive provenance and observer-family qualification, browser final
delivery/entry holding, replay's distinct evaluator/recipe, complete graph and
cache lifecycle, and C2 pre-import diagnostic ordering. A successful ordinary
offline verify does not install the private live staging barrier into replay.
[Staged scope](constrained-import-staged-node-results.md), lines 108–114;
[native limits](constrained-import-native-runtime-results.md), lines 44–59;
[#127 matrix](https://github.com/adammedford/replay-lock/issues/127), P3/H5/H8/C2.

No new capability, eligibility, effect permission, application gain or full G1B
completion follows. #106 stays open and #107 blocked. The observer remains a
constrained trusted external route, not a sealed native/transitive family.
This note renews source evidence only; runtime outcomes belong in a separate
completed slice record after the driver's checks actually finish.
