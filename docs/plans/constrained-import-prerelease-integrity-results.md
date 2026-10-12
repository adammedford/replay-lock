# #127: fixed Node pre-release helper integrity

Retained, non-production continuation of [context identity](constrained-import-context-identity-results.md)
and [lifecycle frontier](constrained-import-staged-lifecycle-research.md), based on
`e7792b3`. Implements the proposed pre-release controls and canonical-node probe;
does not implement later-demand observation or complete full G1B.

## Actual controls, unchanged defenses

Three additional closed `stagedControl` selectors require staged Node and the
approved evaluator witness at both workflow and attachment boundaries. Unknown
selectors or missing prerequisites refuse before opening the fixture. No endpoint,
diagnostic variant, callback exposing internal records or production interface is
added. All controls run after complete actual collection, before final current-set
checks and release, on the actual helper node/graph rather than expected copies.

| Probe | Actual mutation | Existing refusal check |
| --- | --- | --- |
| `invalidate-helper` | Preserved Vite graph's `invalidateModule` clears helper metadata/promise/exports/imports | Current helper node state no longer matches retained record |
| `replace-helper-metadata` | Structured clone replaces only helper `meta`; payload remains equivalent | Metadata object identity, independently of content equality |
| `replace-helper-node` | Same-prototype/descriptor clone replaces helper by-id/by-URL entries and file-bucket membership | Both canonical lookups must return the exact retained node |

The canonical clone retains its metadata, promise, exports and set references;
those payloads do not teach the expected preparer. It is deliberately **not** a
namespace to admit or evaluate. The original evaluator cannot run with any of
these probes through the selected witness-enabled fixture, even during guard
refutation. Original late code mutation, independent preparation and natural
witness-off release remain untouched. No production defense needed modification:
this slice adds finite public coverage for existing checks.

Primary installed Vite 8.2.2 source:
`node_modules/vite/dist/node/module-runner.js:279-328` owns graph lookups, three
maps, node creation and invalidation; `:1170-1183` owns request promise state;
`:1228-1273` owns actual evaluator contexts and ordinary import demand. Driver
reread source and current disk pins:
runner `c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92`,
node chunk `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0`.
These are compatibility evidence, not exact loaded-byte/transitive provenance.

## Public evidence and specific refutations

Each independently named test pairs an unchanged fresh host reaching
`SYNTHETIC_EVALUATOR_DELEGATE_REACHED` with its actual interference probe returning
`EVALUATED_INPUT_REFUSED` first. Successful assertions inspect zero pending
candidates after ordinary stop; every host closes in `finally`. Same HTTP/witness
seams as the approved previous slice; no private helper assertion or fabricated
case. Zero candidates alone is not a no-delegation oracle. The marker stops before
original evaluation and measures dispatch reachability, not native effects.

Tests first failed because the new private selector was not yet supported:
invalidation 5,905 ms, metadata 5,553 ms, canonical node 5,579 ms. This is honest
probe-availability red, **not** evidence that the existing guard was broken.
Once actual controls were added, independent runs passed in 11,065/11,054/11,072 ms.

Specific temporary source refutations then failed as expected:

- Invalidation: bypass only current-helper validation (keeping global bindings
  and other records checked). Marker became reachable, exit one, 6,045 ms.
  Invalidation changes multiple state fields, so bypassing one field alone would
  not independently disable that helper-state defense.
- Metadata: remove only metadata object identity, keep content/promise/node/context
  checks. Equal-content replacement reached marker, exit one, 6,033 ms.
- Canonical node: remove only by-id/by-URL identity checks, retain id/URL and
  metadata/promise/exports/context checks. Replacement reached marker, exit one,
  6,063 ms. This specifically distinguishes canonical ownership from equal fields.

All three checks were restored immediately. During review-stage cleanup, repeated
new test setup was consolidated into three separate named registrations; no old
test or per-test deadline changed. Restored focused staged set passed 6/6 with
zero failures/skips in 73,162 ms aggregate. New cases: invalidation 11,014 ms,
metadata 11,016 ms, node 11,028 ms; natural release/review/verify 17,607 ms.
Aggregate time is not the individual 60,000 ms ceiling.

Independent Standards and Spec source reviews each found zero actionable findings
in `e7792b3...1292bab`. Typecheck and four changed-file JavaScript syntax checks
passed; typecheck excludes these private JavaScript files. Unchanged full
`npm run verify` exited zero on Node 22.19.0/npm 11.5.2, including tooling,
package contract, packed consumer and locked acceptance with serial browser checks.
Final direct typecheck also passed. The subsequent standalone affected file passed
14/14 with zero failures/skips in 173,634 ms aggregate. New cases: invalidation
10,994 ms; metadata 10,993 ms; canonical node 10,984 ms; natural release/review/verify
17,499 ms. All existing 60,000 ms per-test ceilings are unchanged. Final four-file
syntax checks and diff check passed. No hosted CI claim. Final audit confirms all
three temporary bypasses restored, core guard predicates unchanged, no logging,
and main clean/unchanged at `0867957`. All five scoped manual gates are met,
zero unmet/abandoned; later-witness approval remains outside those scoped gates.
Final regression and source-audit evidence is retained in
[the manual ledger](constrained-import-prerelease-integrity-gates.md).

## Remaining sequence and explicit approval checkpoint

Pre-release probes do not exercise changes made after entry begins. The existing
witness stops at the first entry delegate. A later-helper witness must deliberately
permit earlier checked entry and trusted observer delegation; its refusal cannot
be described as zero prior graph evaluation. Before implementation, ask:
**May the private ordinary-HTTP fixture add a helper-only delegate witness, allowing
the already-checked entry and trusted observer to delegate first, while still
stopping before the original helper evaluator?** No such witness was added here.

The larger feasibility assessment remains source/evidence-based, not new runtime
qualification:

| Prerequisite | What existing evidence supplies | Required next proof/design |
| --- | --- | --- |
| Native executable provenance | Exact trusted observer route, current disk hashes and selected native hook/export identity | Actual loaded executable/transitive family binding and trust boundary; route identity is insufficient |
| Browser final release | Existing browser recording/sealed-analysis tests and a late client transform control | Independently bind final browser representations/URL rewriting and hold entry until complete closure passes; Node staging does not install this |
| Replay barrier | Ordinary inspected/reviewed offline verification and safety preflight | A separate actual replay adapter with final-input/source binding and the same admission rules; live private staging is not inherited |

See [native limits](constrained-import-native-runtime-results.md),
[final-recipe limits](constrained-import-final-node-results.md), and the
[#127 matrix](https://github.com/adammedford/replay-lock/issues/127) P3/H5/H8/C2.
The larger steps require their own bounded designs and public oracles before
implementation; neither successful HTTP refusal nor a file hash supplies them.
Nested-state and graph-owner/method interference, arbitrary async races, general
graphs/cache invalidation, native effects and C2 ordering remain open. Private
timeouts supervise transaction promises, not cancellation of arbitrary operations.

Retain outside main; no production PR/merge, new eligibility/effect permission,
API/schema/profile/dependency/application change or pinned-application gain.
#106 stays open; #107 blocked. The scoped gates do not close #127 or full G1B.
