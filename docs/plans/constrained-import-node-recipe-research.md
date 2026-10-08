# #127: fixed live Node downstream recipe

Source-only audit at `c36d9069ad40a3f796ede4d6d78a172b4b20c742`.
No application/config/plugin evaluation, compilation, host launch, tests, build,
or installation. This advances the [instrumentation result](constrained-import-reference-worker-results.md),
not executable qualification. References below are measured installed sources.

## The missing ordered stages

The actual fixture declares `configFile:false`, `envFile:false`, the generation
gate and ReplayLock, `optimizeDeps.noDiscovery:true`, middleware mode and no
watcher. References are prepared before listen and recording starts afterward.
The runtime declaration is this inline configuration, **not** the captured
`vite.config.mjs`, which is subsequently used by offline replay. [R1]

For ordinary `ssrLoadModule`, Vite creates its own SSRCompatModuleRunner with
ESModulesEvaluator, no HMR and no sourcemap interceptor. `ssr` is a server
consumer, nonbundled under the declared serve configuration; server defaults keep
process environment rather than replacing it. Assert those resolved assumptions
against a fixed independent declaration; do not learn the reference recipe from
the actual mutable environment. Hook `order` separately sorts transform hooks:
ReplayLock's `order:"pre"` puts instrumentation ahead of normal Vite transforms,
even though plugin-array placement alone would not. [R2–R4]

| Ordered stage | Fixed `.mjs` candidate applicability / condition to enforce |
| --- | --- |
| Owned load | Generation gate returns retained authored application text; incoming map is absent. Retain raw URL, physical id and `originalCode` as authored load text. [R1,R5] |
| ReplayLock pre transform | Existing independent worker prepares entry instrumentation; a zero-target helper can return null on the actual authored-only path. Continue with authored helper code, not a presumed emitted runtime import. Validate exact code/map/targets first. [R4,R6] |
| HTML proxy / CSS / banner-footer | HTML proxy has load/resolve hooks only; CSS transform id filters exclude `.mjs`. Banner/footer plugin is absent unless configured and its default include excludes `.mjs`. Bind absence of custom filter/banner/footer. [R7] |
| Oxc runtime, oxc transform, JSON | JS oxc transform's default include is `\.(m?ts|[jt]sx)$`, excluding `.mjs` with or without ordinary query. But runtime/JSON plugins delegate to native Rolldown builtins: installed constructors do **not** prove their transform filters or no-op behavior. Do not silently skip them. [R8] |
| Wasm / worker / asset | Wasm and asset have selected load/resolve hooks; refuse wasm/assets/raw/url imports. Worker transform requires `worker_file&type=...` query. Exact query-free `.mjs` bypasses it. Forward-console has no transform hook. [R9] |
| `vite:define` | Server hook does run. With declared empty define and `keepProcessEnv:true`, generated pattern is null and it returns; otherwise its Oxc replacement is an additional stage. Bind both values, rather than inspect authored code only. [R10] |
| CSS post / build HTML / import-meta URL | CSS post id filter excludes `.mjs`; build HTML requires bundled environment; worker/asset `import.meta.url` plugins require client consumer. These exclusions follow id/consumer, not absence of syntax in emitted instrumentation. [R11] |
| Dynamic import vars / glob | Dynamic vars uses a code filter, then only rewrites template-literal dynamic imports; glob uses `import.meta.glob` filter. Assert absence on **independently instrumented** code or refuse; authored qualification alone is not this condition. [R12] |
| Client injection / CSS analysis | Client injection handles exact Vite client/env ids or client consumer `process.env.NODE_ENV`; selected server application ids bypass it. CSS analysis id filter excludes `.mjs`. [R11,R13] |
| SSR import analysis | **Active, not a no-op.** Relative helper resolves to physical `<root>/helper.mjs`, normalizes to `/helper.mjs`, and rewrites import literal. Bare runtime stays bare only when fixed externalization policy proves external; otherwise resolver/graph normalization applies. Import-meta env handling remains enabled in SSR; only client HMR/query/base rewriting is omitted. [R14] |
| Map finishing, SSR lowering, delivery | Independently reproduce the concrete rules below, then compare the final retained representation before ordinary evaluator release. [R5,R15–R17] |

This table enumerates the relevant fixed-stage recipe, **not** a complete proof
that every real hook is absent or pure. `resolvePlugins` also includes resolver,
alias, package watcher, pre/normal/post and optional build/devtools plugins; their
identities, hook sets, ordering, applicability and injected imports must be bound.
Native builtin transform filters remain a concrete unresolved boundary. Moreover,
`makeBuiltinPluginCallable` obtains the exposed hook set and each hook's `order`
from `BindingCallableBuiltinPlugin`. The table therefore describes the declared
array pipeline and known JS hook order, not a certified final native-inclusive
transform order. Native applicability **and hook ordering** must be bound before
using this as an executable recipe. [R3,R8,R22]

Follow-up: [version-matched native source audit](constrained-import-native-recipe-research.md)
narrows these two implementations' applicability/order conditions. It does not
establish the selected running binary, enumerable JS hook set or final parity.

## Maps and executable representation

1. Plugin-container accepts string or object returns and only pushes truthy maps
   when code is supplied; null does not erase the prior map. SSR import-analysis
   uses `transformStableResult`, returning null map during serve. Consequently a
   literal URL rewrite can retain ReplayLock's instrumentation map without adding
   a rewrite map. Its map is not the map a new independent MagicString rewrite
   should generate. `_getCombinedSourcemap` substitutes id/original authored code
   for single empty source, parses string maps, handles `{mappings:""}` sentinel,
   and composes newest map over previous maps through `combineSourcemaps`. [R4,R15]
2. `loadAndTransform` sets `originalCode` to **loaded authored code**. It adopts
   transformed code/map only when code differs, then normalizes string/null maps,
   fills absent sourcesContent (which can read ambient filesystem), calls the
   configured ignore-list function, and relativizes absolute sources to module
   directory. Require complete retained sourcesContent and pinned/declarative
   ignore-list behavior; absent content or unknown callbacks refuse, not reread.
   Default ignore-list is node_modules membership. [R5,R16]
3. `moduleRunnerTransform(code, normalizedMap, requestURL, originalCode, options)`
   performs lowering. Script output records deps/dynamicDeps; map uses basename
   of request URL and originalCode before composition. An empty mappings sentinel
   bypasses generated map; nonempty incoming maps compose. JSON stringify option
   selects a different path only on JSON requests; forbid these in this slice.
   Retain exact URL/query separately from physical id, and map field order used
   by subsequent JSON serialization. [R17]
4. Live `fetchModule` is **not** its transform result: cold inline reply has
   code/file/id/url/invalidate. It normally inlines maps with evaluator startOffset,
   strips previous inline data maps, trims code, appends physical-id sourceURL,
   Vite marker and base64 JSON map, then blanks a leading hashbang. This mutates
   result.code, so a shared map/result object is not an immutable reference.
   Offset comes from AsyncFunction's platform-dependent declaration padding plus
   one; source audit has not measured its numerical value. [R18,R19]
5. `fetchModule` can return `{cache:true}` or externalize rather than emit code;
   runner cachedRequest can return an existing evaluated promise/namespace without
   entering evaluator. Bare runtime resolution uses external conditions, dedupe,
   symlink policy, root/package cache and ESM classification, then native import.
   The first slice must explicitly admit the pinned trusted runtime route and
   refuse unexplained application native/cache routes. Whole transitive runtime,
   native parser and map-library identity is not established by the hashes below.
   The evaluator constructs its strict AsyncFunction with six fixed argument
   keys and supplies import-meta/import functions; bind this context contract,
   not just the text offered to it. [R18–R20]

## Smallest bounded runtime slice, still unexecuted

Extend the separate preparation worker's two records with a private immutable
declaration of ids/URLs, environment values, accepted ordered stage identities,
edge-to-resolution table, runtime externalization decision, no optimizer metadata,
complete incoming maps, ignore-list rule and final decoration policy. No actual
transform result, graph, cache, request-learned options or namespace enters that
worker. A private pure adapter for the fixed SSR import-analysis subset can use
independent closure edges (`./helper.mjs` → `/helper.mjs`) and explicit runtime
externalization; it must refuse syntax/edges outside that finite declaration.
Use the exported pinned lowering algorithm only after independently prepared
post-plugin input. Native wrapper applicability must be resolved or reproduced
before claiming this is the full final recipe; disabling them only on the actual
host would change the workflow under test. [R3,R8,R14,R17]

Publish the whole independent closure first. While HTTP application paths remain
withheld, prewarm **both actual** application transform/fetch representations
without evaluator import and compare them with independent references. Retain
those exact actual release objects, or validate fresh copies at final evaluator
boundary; unconstrained retransformation after prewarm leaves a gap. First entry
release requires all records validated. The existing evaluator setter alone only
checks modules lazily and cannot establish this whole-closure barrier. [R1,R18–R20]

Keep the existing late helper control in `controlFixtureCode`: it changes final
evaluator `const scalar = 3` to 4 after instrumentation publication. Insert final
comparison **after** this control and before delegating to original evaluator;
also mutate the helper in withheld actual preparation to refute the whole-closure
barrier. Independent references must remain unchanged under either mutation.
Unguarded natural HTTP remains 8; guarded response must refuse with zero pending
candidates; unchanged natural HTTP remains 7 with inspected complete observation.
Do not move the late control upstream. Warm reuse must either prove retained
ownership or refuse; do not count evaluator non-entry as a successful check. [R21]

Then acquire separate post-preflight replay references and repeat ordinary review
and offline verify; Vitest decoration is different and is outside this live Node
slice. No browser/304 guarantee, atomic snapshot, full G1B, C2 diagnostic fix,
eligibility expansion, schema/API change or production merge follows.

## Measured primary sources

V = [Vite 8.2.2 installed implementation](../../node_modules/vite/dist/node/chunks/node.js).
M = [installed module runner](../../node_modules/vite/dist/node/module-runner.js).

- R1: [fixture](../../scripts/prototype-import-workflow.mjs), 132–142, 184–219;
  [generation owner](../../scripts/prototype-import-generation.mjs), 65–106.
- R2: V 11837–11885 (ordinary SSR runner), 36410–36432 (environment defaults).
- R3: V 30473–30551 (plugin array), 30562–30602 (per-hook ordering).
- R4: [live transform](../../src/dev-server.ts), 344–364; V 30900–30955.
- R5: V 20610–20711 (authored originalCode, map finishing and lowering).
- R6: [transform](../../src/dev-transform.ts), 19–64, 167–196;
  [preparer](../../scripts/prototype-import-reference-worker.mjs), 8–25;
  [comparison](../../scripts/prototype-import-reference-comparison.mjs), 9–25.
- R7: V 24308–24335, 22548–22610, 30444–30470.
- R8: V 22, 4126–4198, 30524–30531;
  [Rolldown 1.2.5 constructors](../../node_modules/rolldown/dist/shared/constructors-DklcHr18.mjs), 22–26, 56–59.
- R9: V 21384–21449, 27784–27805, 28415–28465, 30368–30393.
- R10: V 25287–25384, 36424–36427.
- R11: V 22665–22677, 22985–23010, 24485–24491, 28750–28768, 29182–29204.
- R12: V 29406–29485, 29488–29509.
- R13: V 25428–25458.
- R14: V 27414–27479 (external policy), 27937–27945 (root URL),
  28001–28055, 28066–28104, 28136–28190, 28201–28243 (SSR rewriting).
- R15: V 2973–2980, 31237–31296, 2578–2600.
- R16: V 19600–19669, 26759–26773.
- R17: [export](../../node_modules/vite/dist/node/index.js), 1–2;
  V 12393–12430, 12553–12579.
- R18: V 34296–34365; M 1207–1240.
- R19: M 23–31, 1018–1026 (padding and evaluator); source not executed.
- R20: V 20550–20608 (transform caches); M 1098–1108, 1170–1195, 1240–1273.
- R21: [attachment](../../scripts/prototype-import-live-attachment.mjs), 28–47;
  [controls](../../scripts/prototype-import-attachment-controls.mjs), 6–13.
- R22: [Rolldown callable adapter](../../node_modules/rolldown/dist/shared/normalize-string-or-regex-CFtim40S.mjs),
  15–39 (native hook discovery, invocation and `getOrder`). Driver source reread;
  no binding construction or plugin execution performed.

Fresh SHA-256 measurements (selected files only, not transitive inventory):

| Source | SHA-256 |
| --- | --- |
| V | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |
| M | `c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92` |
| Vite index | `c7ea52906f843318d7971209ce62bd24bab60590275e8f415c5564fa35cb82dc` |
| Rolldown constructors | `ec42b07a5ad6a91ed5abb74816f7469b6083582e846a73b52de86d08984d31e7` |
