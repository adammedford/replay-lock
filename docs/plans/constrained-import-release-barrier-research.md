# #127: final Node release barrier source research

Subsequent retained implementation: [fixed Node staged release results](constrained-import-staged-node-results.md).
The source-only findings below remain historical; that continuation does not
complete full G1B or qualify native/transitive execution.

Research only, against checkout `aeec529912038c28aa78076f7f1974ea7c8a9479`. No fixture execution, installation, test, or release-barrier implementation was performed. This does not complete G1B.

## Answer

The current cold preparation cannot establish whole-family final release: it observes `fetchModule` representations before the existing evaluator attachment applies the helper mutation. The same pinned runner exposes enough internal operations to investigate a **nonexecuting staging barrier for the fixed two-inline-module fixture**, retaining the actual post-control evaluator inputs and releasing them only on ordinary import demand. That is a source-supported candidate, not a demonstrated safe implementation or a qualification of the native observer's executable closure.

Merely pausing the entry evaluator until all its dependencies reach the evaluator deadlocks: dependency requests are closures supplied to the entry's executing lowered code, not a traversal performed by `directRequest` before evaluation. Staging known independent declarations is required; learning that declaration from actual output is not acceptable.

## Primary-source inventory

Installed source root: `/Users/adammedford/Projects/replaylock-reference-127/node_modules/vite/`. Version is **8.2.2**, `package.json:3`. SHA-256 hashes read from the installed files:

| File | SHA-256 |
| --- | --- |
| `dist/node/module-runner.js` | `c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92` |
| `dist/node/chunks/node.js` | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |

These match the existing private attachment pins (`scripts/prototype-import-live-attachment.mjs:18-25`). They are compatibility evidence for files currently readable from disk, not proof of exact already-loaded JS/native bytes, source-to-binary provenance, or transitive inventory.

## What the installed runner actually does

1. `ssrLoadModule` assigns Vite's own `SSRCompatModuleRunner` synchronously, then `instantiateModule` calls `runner.import`. The existing attachment setter runs before that import. The subclass uses the original `ESModulesEvaluator`, native import metadata, no HMR, and records `ssrModule`/`ssrError` after the underlying request settles. Sources: `dist/node/chunks/node.js:11837-11883`; existing setter `scripts/prototype-import-live-attachment.mjs:26-55`.
2. `import` calls `cachedModule`, then `cachedRequest`. `cachedModule` fetches metadata without itself evaluating inline code. `getModuleInformation` can reuse `{cache:true}`, invalidate mutable module state, and assign fetched metadata to an evaluated-module node. Sources: `dist/node/module-runner.js:1133-1136,1185-1227`.
3. `cachedRequest` starts `directRequest`, stores its pending promise, and later marks the module evaluated in `finally`. If a promise already exists, it normally waits for it; cycle handling may return exports instead. Sources: `dist/node/module-runner.js:1161-1183`.
4. `directRequest` constructs the import request closure and inline context, then immediately calls the evaluator. Dependencies are requested only when lowered code invokes that closure. An external request directly calls the external evaluator and stores its exports. Sources: `dist/node/module-runner.js:1228-1273`. The original inline evaluator creates/invokes an `AsyncFunction` and seals exports; the external evaluator invokes native `import(filepath)`. Sources: `dist/node/module-runner.js:1018-1025`.
5. `fetchModule` externalizes builtins, data/network URLs, and bare imports resolved with an importer; inline requests get transformed code and metadata. Its cache short circuit and inline-map decoration occur before the attachment boundary. Sources: `dist/node/chunks/node.js:34296-34364`. `environment.fetchModule` is explicitly documented as not meant for manual invocation, so the retained fixture is relying on an internal/experimental seam, not a stable public contract (`dist/node/chunks/node.js:35541-35551`).
6. The current guard prepares two fetch replies, then checks each inline input lazily after `controlFixtureCode` runs. The helper's scalar replacement occurs only in that late control. Sources: `scripts/prototype-import-final-node-guard.mjs:31-52`; `scripts/prototype-import-live-attachment.mjs:48-52`; `scripts/prototype-import-attachment-controls.mjs:6-12`; entry invocation `scripts/prototype-import-workflow.mjs:199-202`.

Consequently, successful cold preparation does not entail successful final comparison, and helper refusal can occur after entry evaluation has started. The existing `withheld-mutate` operation changes the fetched reply copy compared during preparation, not the cached representation later delivered to the evaluator (`scripts/prototype-import-final-node-guard.mjs:37-40`).

## Candidate: stage actual evaluator inputs, then activate on demand

Keep independently prepared expected code separate from actual runner/cache state. The fixed recipe already declares precisely entry → observer runtime + helper, helper → no imports, rejects dynamic/re-export/undeclared edges, and verifies lowered dependency declarations (`scripts/prototype-import-final-node-recipe.mjs:36-53,63-67`). This declaration can drive staging; actual outputs may be checked against it but cannot supply expected values.

The candidate sequence is:

1. On Vite's existing runner assignment, attach the same late control and a staging evaluator wrapper. Retain original inline/external evaluator functions. Start a finite staging transaction before allowing the ordinary entry import to evaluate.
2. Fetch each declared inline module through the actual runner's `cachedModule`, then initiate its original `cachedRequest` without awaiting completion. Wait instead for that request to reach the evaluator wrapper. The wrapper applies the **same existing late helper control in the same boundary position**, compares the final code/file/id/url with the independent table, retains the original evaluator receiver, context, immutable code string and actual module object, and returns a deferred completion promise without calling the original evaluator.
3. Resolve the declared bare observer route with the declared entry importer, checking exact external target/type. If staging its `cachedRequest`, retain its original external evaluator call without invoking native import. Resolving the route is not validating observer/transitive executable bytes. An unproved route cannot be silently promoted to a qualified external family.
4. Admit only after every declared final inline input has arrived and passed, and every required external route has been accounted for. Refusal must reject all deferred requests, retire the transaction, prevent every original evaluator call, and settle outstanding promises without unhandled rejection or hanging shutdown.
5. Activate entry's retained call once. When its ordinary lowered import requests observer/helper, a demand-sensitive wrapper around the existing `cachedRequest` must activate that exact retained call **before** delegating to the original cached-request behavior. No fan-out `Promise.all` of original evaluators: that evaluates helper/observer speculatively and changes ordinary dependency order.

The demand wrapper is essential: staged `cachedRequest` has already populated `mod.promise`; the unmodified demand path merely awaits it (`module-runner.js:1172-1180`). Releasing entry alone therefore leaves its dependency promises pending forever. A blanket global "release all" solves the wait by changing semantics, not by preserving the ordinary path.

Retained release objects must be consumed once, without refetch, re-running the mutation, or reconstructing code from mutable caches. Module-node identity, metadata identity/content, expected `mod.promise`, evaluator functions, transaction epoch, invalidation state, and declared request URL/importer must remain bound; drift must refuse. The code string is immutable, but retained context, module metadata and closure state are not. A fixed trusted-host/no-interference proof is necessary; freezing a record does not freeze its closures or make those objects immutable. Do not freeze all of Vite's module/context objects indiscriminately: Vite intentionally mutates exports/import graphs and stores results. Its invalidation method clears metadata, promise, exports and imports (`module-runner.js:317-328`); release must explicitly reject an invalidated or replaced staged node.

Calling helper's staged request with an empty callstack differs from its ordinary dependency callstack. For this fixture the helper has no dependencies, so the candidate can explicitly restrict admission to that shape; this does not establish correct cycle, re-export, import-meta, dynamic import, top-level-await, HMR, or arbitrary graph behavior. Inline context/import-meta construction occurs during staging (`module-runner.js:1244-1272`), before release. The barrier can potentially promise zero original *fixture evaluator* calls on refusal, not zero trusted toolchain/configuration/metadata effects.

## Alternatives and decision

| Approach | Source-supported consequence | Decision |
| --- | --- | --- |
| Keep only cold `fetchModule` comparison | Does not observe the late control | Useful existing diagnostic, insufficient final barrier |
| Pause entry and wait for normal dependency evaluator arrivals | Dependencies require entry execution to request them | Deadlock; reject |
| Apply mutation during preparation instead | Tests a different boundary and misses the existing downstream gap | Reject as replacement control |
| Stage original evaluator inputs and release all at once | Executes dependencies speculatively, changes order | Reject |
| Stage finite declared inputs; release on ordinary demand | Potentially binds final code while keeping original evaluator behavior | Next bounded prototype candidate; not yet verified |
| Replace runner with a general owned linker/evaluator | Could own a complete closure, but introduces much larger semantic/provenance obligations | Separate architecture investigation, outside this slice |

## Concrete next gate

Before any full G1B claim, a throwaway, private fixed-fixture experiment must establish all of these together:

- Unguarded unchanged release still returns 7; unguarded original late helper mutation still returns 8. Guarded identical mutation returns typed refusal, zero pending candidate, **and zero original entry/helper/external evaluator calls**. Zero pending candidates alone is not an evaluator-start oracle.
- Successful release retains and consumes the exact staged post-control code/context/module objects once, with ordinary entry → observer → helper demand order; no speculative helper/native import and no second late-control pass.
- Refusal after any partial staging settles all retained promises and closes cleanly; unknown/duplicate/replaced/invalidation/warm/alternate-path demands refuse. A timeout is a failed lifecycle gate, not a passing refusal.
- Independently declared expected records stay isolated from actual outputs/caches. Comparator-disabled and activation/bypass negative controls must visibly falsify the new assertions, then be restored.
- Public record → inspect → explicit review → ordinary verify remains intact; existing locked acceptance tests and full verification are unchanged, under the existing 60-second per-test ceiling. Ordinary offline verify is not proof that this private live barrier exists during replay.

The missing evaluator-start oracle is a concrete open gate, not an implementation detail to infer from refusal. The placement prototype exposes the distinct `SYNTHETIC_PRELUDE_REACHED` string through HTTP (`scripts/prototype-import-placement.mjs:165-168`), but the current workflow normalizes unknown errors to `GRAPH_REFUSED` (`scripts/prototype-import-workflow.mjs:207-209`). Its ordinary authored qualifier rejects a throw statement (`scripts/prototype-import-placement.mjs:27-48`); the earlier isolated exact-source witness exception (`:53-57`) is not qualification of an application graph and is not present in the actual workflow. That earlier route is therefore not evidence that the witness works here. Do not silently add a new public seam, loosen the authored qualifier, or substitute private evaluator counters/zero candidates to obtain a passing public oracle.

Proposed human checkpoint: approve a **fixture-only evaluator-delegate witness** exposed through the same ordinary HTTP request. In a separate isolated control mode, trusted host dispatch would throw a distinctive marker immediately before delegating an inline or external call to the preserved original evaluator. Its unguarded control must reach that marker; guarded late helper drift must refuse before it. This measures reachability of the dispatch point, not execution of the original evaluator or an application native effect. Keep the normal unchanged7/unguarded8 experiments separate and unmodified. The marker is a new observable diagnostic variant, so do not implement it without explicit agreement; never turn it into a production code, application counter, fabricated observation, source exception, or substitute for later native-effect oracles.

## Proposed implementation order after the witness decision

1. Establish the isolated HTTP witness and its reachable negative control first; stop if the actual workflow cannot distinguish it from refusal without weakening qualification.
2. Collect the two declared actual post-control evaluator inputs inside the existing owned turn. Distinguish collector requests from ordinary execution demand explicitly; an async global staging flag must not authorize an unrelated request. Bind the original evaluator functions, exact canonical module nodes, promises and request identities.
3. Seal only the complete checked set, then activate entry and each dependency on ordinary demand. Test incomplete collection, refusal cleanup and demand deadlock before treating a positive response as success.
4. Repeat unchanged7, unguarded original late8 and guarded identical late refusal through natural HTTP; use the separately approved witness to test the no-delegate-before-refusal assertion. Refute comparator and release-order checks independently, restoring each immediately.
5. Inspect the real unchanged candidate before explicit review and ordinary offline verify; rerun unchanged full verification and independent Standards/Spec review. Report this as a fixed inline-family barrier only if all checks pass. Native/transitive family ownership and browser/replay recipes remain separate mandatory work.

Driver independently reread the consequential collection, demand, evaluator, invalidation, lowering and workflow sources and remeasured both Vite hashes above on 2026-10-11. Node22.19.0/npm11.5.2 were checked without launching a fixture. Documentation-only diff checks passed; no runtime verification from the preceding commit is renewed by this research.

The runtime entry's native-loaded/transitive qualification remains a distinct prerequisite for calling the **complete executable family** qualified. A bounded inline-family experiment may be useful even before that prerequisite, provided its report explicitly calls the observer a trusted, constrained external route rather than a sealed executable closure. Native/toolchain source and loaded-byte provenance, other platforms, browser/replay barriers, arbitrary graphs, and full G1B/C2 remain open.

Follow-up: the user approved the fixture-only HTTP witness on 2026-10-11. Its
[retained implementation and controls](constrained-import-delegate-witness-results.md)
characterize the current lazy entry-release gap. This resolves the observable
signal decision, not the staged barrier's runtime or semantic gates above.
