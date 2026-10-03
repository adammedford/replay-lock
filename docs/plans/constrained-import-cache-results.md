# #127: load-only placement fails warm-generation feasibility

Status: **failed placement**, retained outside main. This is not a completed
whole-adapter evaluation or a claim that every possible adapter is infeasible.
Admission expansion stops at the spec's enforcement feasibility checkpoint.

## Question and public outcomes

Can the current fixture load gate close a generation when its source changes,
before the normal HTTP handler or browser button reuses cached application code?

The probe first runs the qualified scalar graph naturally, observing7. It then
replaces the helper with `export const scalar = 4; export const unused = { value: 0 };`.
The object initializer is outside the controlled grammar but harmless: no logging,
I/O, timers, listener registration, getters or global writes are executed even if
the placement fails. No native-effect oracle or prevention success is claimed.

| Placement | Observed outcome after source replacement | Required outcome |
| --- | --- | --- |
| Same live Node generation | Ordinary HTTP request succeeds with old result7 | Refuse before cached invocation |
| Same Chromium page | Another real button click settles with old result7 | Close/refuse the stale generation |
| New Chromium page, same warm server | Entry request succeeds and button settles with old result7 | Fresh realm must not borrow stale server qualification |
| Existing stop invalidates caches; later Node request or new page | Node409 GRAPH_REFUSED; browser entry404 and dynamic import rejects | Cold refusal control only |

The initial Node probe stopped recording before the edit and appeared to refuse.
Source inspection showed stop invalidates module graphs and sends a real reload.
Moving the edit and second invocation before stop exposed HTTP200 instead of409.
The browser refusal-oriented probe timed out waiting for an import error; the
retained characterization requires a newly settled output7, not absence of errors
or an old displayed value. A fresh page also received cached server source.

## Retained evidence is a failure characterization

`test/acceptance/prototype-import-cache-feasibility.test.mjs` deliberately asserts
the observed failed placement and the cold refusal controls. Passing that file
means the failure is reproduced, **not** that H8 or G1B passes. The original
record/review/verify tests and all existing acceptance requirements are unchanged.
No adapter is fixed, no unsupported source is accepted, and none of this probe's
pending observations is reviewed or committed. The synthetic fixtures are removed
by their existing cleanup. The new file runs in the serial browser pass.

The source gate has no obligation check on an already-returned namespace or on a
browser module-map hit. A load hook also cannot require a server transform-cache
hit to rerun qualification. Its cold-source behavior is not generation ownership.
This experiment uses the fixture's existing `watch:null` restriction and makes no
claim about arbitrary HMR, already-running attach, replay-worker caches, native
external shortcuts or every possible filesystem watcher configuration.

## Decision boundary

G1B remains unmet with concrete live-cache failure evidence. Final transformed-byte
binding, resolution/native-route coverage and isolated-worker cache feasibility
are also unproved. Do not continue with the diamond fixture, new eligibility,
effectful application imports or production delivery on the basis of the earlier
positive workflows.

The cold browser middleware response is a coarse404, not a typed GRAPH_REFUSED
diagnostic. Its rejected import and unset UI output demonstrate failed delivery,
not independently established native-effect prevention or a complete refusal taxonomy.

A replacement placement would need ownership of a complete application generation
across the host runner, transformed-source cache and browser realm, with refusal
before any reuse and a fresh host/realm after invalidation. Merely adding another
load/transform check, a watcher or cache-busting URL does not prove that contract.
Select and evaluate such a placement separately before resuming expansion; no new
client protocol, production loader API, profile or artifact fact is selected here.
#106 remains open; #107 stays blocked. Main and the pinned application are outside
this experiment.

## Verification and independent reviews

At implementation revision `7d362ecc3ddda5eccb8fe87b406b0081fc309a6a`, the full
unweakened `npm run verify` passed: verification runner, package contract, packed
consumer, locked acceptance files and serial browser pass. The properly serial
focused command passed all four cache/workflow tests; after the review cleanup,
the cache file alone passed both tests. Typecheck and `git diff --check` passed.
Typecheck covers the existing TypeScript surface, not these prototype JavaScript
tests. Runtime/dependency pins and the60000ms test ceilings are unchanged.

A combined focused command with its concurrency option after the filenames had
timed out at the original workflow's startup reload wait. The correctly ordered
`node --test --test-concurrency=1` run and full locked runner passed; no test,
checkpoint assertion or timeout was removed to obtain that result.

### Standards

Four-pass independent review found no documented-standard violations and one
lifecycle finding: detached event waits could reject unhandled when a click or
assertion failed. Immediate `Promise.all` handling was added at7d362ec and the
reviewer independently confirmed resolution. No actionable findings remain.

### Spec

Four-pass independent review found zero actionable mismatches in the failure
characterization. It confirmed harmless source, newly settled public outcomes,
cold controls, unreviewed probe artifacts and the explicit failed-H8/G1B boundary.
It did not certify complete-adapter feasibility or remaining matrix requirements.

Primary main remains clean at0867957. The pinned application remains at8473afd,
with pre-existing dirty paths and Noble sha3 source hash unchanged. No application
target or configuration was executed; no dependencies or lockfiles were changed.
