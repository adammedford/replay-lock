# #127: independent-reference acquisition frontier

Source-only research at `ced4a2c6c5d42679a0bd6100be0938a816fd8456`.
No application imports, configuration/plugin execution, compiler probes, tests,
browser runs or installs were performed. This advances the earlier
[recipe audit](constrained-import-recipe-research.md): the private live and
post-preflight replay analysis projections now exist, but a final executable
reference does not. Recommendations below are unexecuted experiments.

## Answer

The first concrete acquisition frontier is **a fresh preparation worker receiving
the retained finite snapshot and explicit transform parameters**, not a second
call through the actual host's project cache. Prepare instrumentation for *every*
qualified application module in each selected realm before releasing the entry.
Use the original physical ids in that worker; a relocated shadow directory would
change path-sensitive maps and resolution. This is feasible from the existing
private projection and transform entrypoint, but is only an instrumentation
reference until downstream host stages are also independently reproduced. [S1–S4]

There is an unusually useful next Node frontier: installed Vite publicly exports
`moduleRunnerTransform`, the `ssrTransform` function used by its real
`loadAndTransform`. It accepts code, incoming map, URL, original code and options,
and parses/rewrites code without evaluating the application. A private preparer
can call this fixed algorithm on independently prepared *post-plugin* inputs.
It must not pretend that raw ReplayLock instrumentation is already that input:
the real host runs ordered plugin transforms and map finishing first. Browser
import rewriting is more stateful and has no equivalent string-only frontier in
the inspected implementation. [S5–S7]

## Measured primary sources

Repository sources below are unchanged at the baseline; references give measured
one-based lines. Installed dependency links identify the inspected local source,
not a portable transitive inventory.

- S1: [capture and private live injection](../../scripts/prototype-import-analysis-bootstrap.mjs),
  19–73 (six-file capture/currentness), 76–82 (registration), 85–109 (selected
  pinned loaded-source redirects); [snapshot view](../../scripts/prototype-import-analysis-view.mjs),
  4–39 (retained reads, direct-child absences, terminal unknown access).
- S2: [replay phase state](../../scripts/prototype-import-replay-analysis-state.mjs),
  8–23 (physical-preflight guard and fresh replay capture/qualification);
  [replay preload](../../scripts/prototype-import-replay-analysis-preload.mjs),
  9–16 (exact configuration text), 17–46 (pins and injection placement).
- S3: [transform](../../src/dev-transform.ts), 11–13 (fresh project entrypoint),
  19–64 (realm/options cache and one-module overlay), 68–80 (id/targets),
  126–133 (embedded metadata), 167–196 (runtime import, replay exports, map).
  [analysis](../../src/dev-analysis.ts), 257–270 (compiler-host overrides),
  1160–1170 (options/realm/source/metadata digest).
- S4: [generation owner](../../scripts/prototype-import-generation.mjs), 44–62
  (owned turns), 65–85 (qualified closure), 96–106 (retained application loads).
  [live host](../../src/dev-server.ts), 330–339 (virtual runtime), 344–364
  (actual live transform arguments). [ordinary replay](../../src/dev-verify.ts),
  196–217 (phase, parameters, aliases), 250–268 (instrumentation/environment
  stages), 318–332 (configuration, optimization, separate browser project).
- S5: [installed Vite export](../../node_modules/vite/dist/node/index.js), 1–2;
  [installed Vite implementation](../../node_modules/vite/dist/node/chunks/node.js),
  12393–12435 (`ssrTransform`, parser and import lowering), 12553–12574
  (import-meta lowering and original-code/map composition), 20610–20711
  (`loadAndTransform`: load, plugins, maps, lowering, graph publication),
  30900–30954 (ordered transform hooks and map composition).
- S6: same installed Vite implementation, 28001–28055 (import-analysis config,
  environment, graph and optimizer), 28066–28104 (resolver, URL normalization,
  HMR/version/base inputs), 28233–28243 (graph update and output).
- S7: same installed Vite implementation, 20550–20607 (pending/cached requests),
  20720–20759 (soft-invalidated client timestamp rewriting), 34296–34364
  (external/cache replies, fetch decoration, hashbang).
- S8: [installed Vitest fetch processing](../../node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js),
  1124–1137 (cached reply and Vite fetch), 1174–1207 (graph result and map
  decoration), 1209–1216 (cache metadata reply).
  [installed evaluator](../../node_modules/vitest/dist/module-evaluator.js),
  70–82 (external native import), 106–108 (inline boundary), 163–206 (metadata,
  argument list, wrapper and VM compilation).
- S9: installed Vite implementation, 25193–25215 (client transform to HTTP send),
  19688–19716 (ETag/304, supplied/fallback maps, HEAD/body).
  [replay environment transformation](../../src/dev-verify.ts), 38–61.

Read package metadata identifies Vite **8.2.2**, Vitest **4.1.11** and
`@vitest/browser` **4.1.11**. Independently measured SHA-256:

| Installed source | SHA-256 |
| --- | --- |
| Vite `dist/node/chunks/node.js` | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |
| Vitest `dist/chunks/cli-api.CnMVyzaz.js` | `a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e` |
| Vitest `dist/module-evaluator.js` | `a0b36fb2211d2587d8df68d5855d48141be27e99bdb973378a83f927e03b004e` |

## Concrete private candidate

1. At live owner setup, retain the existing finite analysis snapshot separately
   from the actual analysis worker's copy. At replay, acquire a **new** snapshot
   after that isolated worker's physical preflight, not the historical live
   snapshot. Qualify its entire entry/helper closure and refuse unknown reads.
   Replay's current phase hook already supplies this location. Neither capture
   is atomic; successive identity checks remain the stated acquisition limit.
   [S1, S2, S4]
2. Start a distinct private preparation worker with no actual Vite environment,
   project-cache object, graph, transform result or evaluator namespace. Feed the
   snapshot through the same finite read-only projection under loaded-source
   pins; use `transformDevSource` with a fresh plan per invocation, then assert
   the projection's sticky refusal before publishing. For this two-module
   fixture, prepare both modules before any application entry release; retained
   bytes are explicit overlay inputs, not code obtained from the actual hook.
   Reusing the trusted instrumentation algorithm is deliberate, not algorithmic
   independence or a second implementation oracle. The existing worker protocol
   does not implement this separate whole-closure preparation command: add it
   privately rather than claiming registration alone constructs references.
   Actual transform overlays remain unqualified until compared; a retained base
   plan does not license an arbitrary later `options.code`. [S1, S3]
3. Bind the preparation key and record to: physical root and complete closure
   ids/edges; analysis snapshot identity; exact authored code; realm; full
   resolved options; live generation or replay `"verify"`; `replay` flag; exact
   `runtimeImport`; ordered recipe identity; fixed configuration; resulting code,
   map and source digest. Retain both raw request URL/query and clean physical id,
   and explicit lowering `originalCode`; the transform strips queries for module
   lookup while maps, URL rewrites and lowering have separate identity inputs.
   Null maps are a distinct value. Live browser uses its
   virtual runtime while Node and replay use `replaylock/dev/runtime`; live's
   session/token/startup code is separately identified trusted infrastructure,
   not an application byte exception. [S3–S7]
4. Extend the preparation chain only through a finite *declared* recipe, not by
   calling arbitrary discovered plugins. Node lowering can use the pinned
   `moduleRunnerTransform`; preceding plugin outputs, map composition and
   finishing must first be independently prepared. The replay environment
   transform is a known additional stage even when it is a no-op for this
   fixture. An exact-source private extraction is a candidate technique, not a
   new production export. Unknown configuration, adapter or stage refuses;
   plugin names alone do not establish code identity. [S5, S9]
5. For browser preparation, encode the fixed fixture's independently declared
   alias/edge-to-URL mapping, base, initial HMR state, environment/define values,
   consumer and optimizer policy. A private finite-context adaptation of pinned
   import-analysis is one candidate, but its graph/resolver operations must be
   implemented against that declaration, not the actual host graph. This audit
   does **not** establish the adaptation's completeness or equivalence. Its
   output must be refuted against ordinary Chromium delivery; a standalone
   surrogate that evaluates 7 is not host-enforcement evidence. [S6, S7]
6. Freeze the complete reference table before the actual-release path is enabled.
   Prepare/check every actual closure representation without evaluation or
   application delivery, then release the entry only if the whole table matches.
   A helper-only evaluator check reached after entry initialization is too late.
   Existing hooks are attachment points, not yet a whole-closure release barrier.
   Cache replies and evaluated namespaces require explicit ownership or refusal;
   they cannot be assumed to rerun the transform. The checked actual records must
   be the retained objects later released, or a later pre-evaluation comparison
   must validate fresh copies; a successful prewarm followed by unconstrained
   retransformation leaves a release-time gap. [S4, S7, S8]

## Representation contracts must not collapse into one hash

| Actual frontier | Independently required reference | Later binding still required |
| --- | --- | --- |
| ReplayLock instrumentation return | Code + map + id/realm/options/generation/runtime import + analysis identity | All downstream plugins and map composition; this is **not** executable parity. |
| Live Node `fetchModule` reply | Post-plugin SSR code/map, file/id/url, external/cache status, inline-map/start-offset policy, Vite `sourceURL` decoration and hashbang treatment | Actual module-runner wrapper/evaluation/cache ownership; not audited completely here. |
| Node replay `runInlinedModule` | Processed SSR code with Vitest map decoration, module identity and fixed evaluator context contract | Strict async wrapper, dynamic argument names, VM filename/offset and external/evaluated-cache paths. |
| Browser `transformRequest` return | Final client code **and** map, request URL/id, recipe/config/graph declaration | Deterministic HTTP source-map decoration, ETag, 304/client reuse and body identity. |

Vite can mutate fetch result code to inline maps and blank hashbangs. Vitest
disables that inlining, then prefers the module-graph result, applies its own
first-line-map adjustment and later wraps code for VM execution. Browser HTTP
`send` can append a supplied map, generate a fallback from request URL, or return
304 without a body. Comparing pre-send code alone cannot certify browser wire
bytes; comparing Node replay text cannot certify live Node text. [S7–S9]

## Disprovable independence and smallest next runtime slice

Independence criterion: **after reference publication, modifying only the actual
downstream helper representation must leave every reference record unchanged**.
Deleting the actual host's transform cache must not be necessary to obtain the
reference. The reference worker must neither receive actual transform results
nor read actual graph/cache objects. A reference that changes with the mutation,
or whose first construction happens inside the actual return/evaluator hook,
fails this criterion even if equality checks pass. This is a proposed inspection
and runtime oracle, not observed behavior.

Smallest next slice: the two-file Node live fixture, with an independently
published **whole-closure instrumentation table** before `/invoke`, followed by
actual whole-closure preparation and comparison at that exact frontier. Natural
HTTP result 7 and inspected complete pending observation are the positive.
Change the helper *after actual instrumentation* while the reference is fixed:
unguarded natural HTTP must yield 8. The eventual final-byte guard must refuse
before application evaluation with no pending candidate. An instrumentation-only
guard is expected to fail that latter requirement because the change occurs
after its comparison; record that failure as the boundary of the first slice,
not as final-byte qualification. Do not move the mutation upstream to manufacture
a passing final-byte gate.

Then extend the independently fixed Node recipe through downstream lowering and
decoration and repeat the same late mutation at the last attachment point. Only
after that succeeds, record a genuine unchanged 7, inspect and explicitly review
it, and run ordinary offline verify with the separately acquired replay recipe;
late drift must be infrastructure refusal, not an executed `OUTPUT_MISMATCH`.
Repeat browser live and Browser Mode replay through real Chromium, including maps
and final delivery controls. Preserve 60000ms per-test ceilings and the existing
admitted-old-turn contract. These are proposed checks, not executed evidence.

Full G1B, final executable binding, coherent/atomic acquisition, transitive tool
inventory, cache/native/extra-entry coverage, late-drift lifecycle matrix and
broader qualification remain open. C2's diagnostic-order gap is not solved or
reclassified by this research. No new eligibility, artifact schema, public API,
effect-policy exception, pinned application execution or production merge follows.
