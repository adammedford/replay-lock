# #127: native builtins in the fixed live Node recipe

Source-only continuation of [the downstream recipe audit](constrained-import-node-recipe-research.md),
at `c4c04b2`. No native binding, application, configuration or plugin was loaded or
executed; no host, build or test ran. The finding narrows a source-level blocker,
not final executable parity or native binary provenance.

## Source association and boundary

GitHub's `v1.2.5` ref resolves to commit
`84c904bc2e3fd126c8c32905a2597a6716a69249`, whose
[Rolldown package manifest](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/packages/rolldown/package.json)
declares version `1.2.5`, matching installed metadata. This is version-matched
upstream evidence. It does **not** establish that the installed native binary was
built reproducibly from that commit, nor inventory native/parser/helper transitive
dependencies. The installed constructors associate `builtin:vite-json` and
`builtin:oxc-runtime` with the callable adapter; the immutable
[native builtin conversion](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_binding/src/options/plugin/binding_builtin_plugin.rs#L129-L136)
and [Oxc conversion](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_binding/src/options/plugin/binding_builtin_plugin.rs#L198-L199)
select the corresponding Rust implementations.

The lockfile and installed `@rolldown/binding-darwin-arm64` candidate both declare
`1.2.5`; its file hash is below. This identifies installed candidate bytes, not
the binary selected by a running host. The installed loader
`binding-C__LJDBG.mjs` has explicit native-path override, universal Darwin and
WASI selection/fallback routes (92–95, 187–230, 500 onward). A future runtime
declaration must constrain or identify the selected route; hashing the ARM64
candidate alone is not that proof.

## Hook behavior, not just registration bits

The [callable binding](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_binding/src/options/plugin/binding_callable_builtin_plugin.rs)
defines `resolveId`, `load`, `transform` and `watchChange` methods and `getOrder`.
The installed JS adapter wraps enumerable callable properties and asks native
`getOrder` for each. It does not select methods using `register_hook_usage`.
Therefore Rust usage bits identify intended nondefault hooks, **not** a proven
enumerable JS hook set. Actual N-API enumeration has not been measured. If an
otherwise unused method is exposed, its default behavior follows the
[Plugin trait](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin/src/plugin.rs)
and [Pluginable forwarding](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin/src/pluginable.rs):
resolve/load/transform return `None`, watchChange succeeds without output, and
absent metadata yields no order override.

| Native implementation | Intended hooks and order | Fixed application applicability / output |
| --- | --- | --- |
| [Vite JSON](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin_vite_json/src/lib.rs) | Transform; no metadata override, hence normal if exposed. Other callable routes use trait defaults. | Returns `None` unless module type is JSON **and** id matches JSON extension **and** has no special query. Query-free physical `.mjs` fails the id condition regardless of its code. Applicable JSON returns code, a default source map, and module type JS; it is not a map-free rewrite. |
| [Oxc runtime](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin_oxc_runtime/src/lib.rs) | ResolveId and load both explicitly `pre`. Transform, if exposed, uses default `None` with normal order. | Resolves `@oxc-project/runtime/helpers/…`, or relative siblings of its versioned virtual helper ids. Loads only recognized NUL-prefixed embedded helper ids. No transform override rewrites application `.mjs`. Unknown nonhelper resolve/load inputs return `None`. |

[JSON extension logic](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin_vite_json/src/utils.rs)
accepts `.json` or `.json?…`, excluding the two exact CommonJS proxy/external
postfixes; it does not recognize `.mjs`. The
[transform output binding](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_binding/src/options/plugin/types/binding_hook_transform_output.rs)
preserves the distinction between omitted map, explicit null and map object,
and carries code, moduleSideEffects and moduleType.

Oxc's [embedded helper inventory and recognizers](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin_oxc_runtime/src/generated/embedded_helpers.rs#L5219-L5242)
use versioned prefix `@oxc-project+runtime@0.146.0/helpers/`. Import/dynamic-import
select ESM unless explicitly requested otherwise; require selects CJS. This is a
real executable helper route, not a harmless import renaming. Refuse it in the
two-file declaration instead of silently treating its outputs as sealed
application closure members.

## Invocation context and fixed Vite ordering

The native constructor allocates its own `TransformPluginContext` with empty
code/id state and a new NAPI context; calls forward code, id, module type and
resolve options to the plugin, not Vite's `handler.call(this, …)` receiver.
The [NAPI context implementation](https://github.com/rolldown/rolldown/blob/84c904bc2e3fd126c8c32905a2597a6716a69249/crates/rolldown_plugin/src/plugin_context/plugin_context.rs#L17-L42)
distinguishes native-only operations and rejects those operations on NAPI
context. Both selected implementations ignore `_ctx`; this permits a narrow
source claim about their local branching, **not** general binding purity or a
claim that arbitrary native plugins cannot read ambient state.

Installed Vite `node.js` 30521–30531 includes Oxc runtime for nonbundled
environments when `oxc !== false`, then JS Oxc transform and JSON. Hook sorting
(30580–30600) honors hook `order`, preserving array order within its category.
Thus any exposed Oxc transform and JSON transform are normal-category stages;
ReplayLock's pre transform remains earlier. Oxc's resolve/load are pre-category
routes and must remain explicitly bound even though application transform is a
no-op. This is conditional source reasoning, not a measured native-inclusive
resolved plugin list.

Vite transform passes `{ssr, moduleType}` and defaults moduleType to `js`
(30900–30953); loading can infer or return a different type (20620–20673).
Bind query-free `.mjs` ids and the no-type-changing declaration, and validate
actual stage/options identity rather than infer all applicability from extension.

The fixed fixture authors only entry's relative `./helper.mjs` import and helper's
`scalar = 3`; ReplayLock's insertion imports `replaylock/dev/runtime`
([fixture](../../scripts/prototype-import-workflow.mjs), 15, 97–98;
[instrumentation](../../src/dev-transform.ts), 176). Those construction sites
introduce no Oxc helper edge. Existing JS Oxc default filtering excludes `.mjs`.
Nevertheless the independent instrumented output must be checked for undeclared
edges; authored input inspection is not a substitute for this check.

## Next bounded runtime slice

The source candidate can now declare JSON as a no-output stage for exact `.mjs`
and Oxc transform as default no-output, while refusing every Oxc helper edge/virtual
load. No output is not an emitted transform result with `map:null`.
Do not disable either plugin on the actual host. Before relying on this recipe,
bind installed native identity and validate exposed hooks/orders and the fixed
resolved host assumptions against the independent declaration. Keep those
validations separate from reference acquisition; actual outputs/cache cannot
teach the worker its expected code.

Then implement the finite independent SSR edge rewrite, map finishing, exported
Node lowering and final delivery decoration described in the previous audit.
The first new runtime control must retain ordinary HTTP: unchanged result 7,
late final helper mutation yielding 8 unguarded, and refusal with zero pending
candidates guarded. Keep mutation downstream of instrumentation and compare
after it, before the real evaluator. A separate withheld-preparation mutation
must establish the whole-closure barrier before first entry release; lazy
per-module comparison alone is insufficient. Native enumeration, final parity,
whole-closure release, warm cache ownership, replay/browser routes and transitive
identity remain unproved. No eligibility/schema/API/production change follows.

Fresh selected installed SHA-256 measurements (not loaded-route/transitive inventory):

| File | SHA-256 |
| --- | --- |
| Rolldown callable adapter `normalize-string-or-regex-CFtim40S.mjs` | `ee2f736ddaeb3ca9e435f3e3b823834aabbf7ec935fba5ab7ee0547c87eb459a` |
| Rolldown constructors `constructors-DklcHr18.mjs` | `ec42b07a5ad6a91ed5abb74816f7469b6083582e846a73b52de86d08984d31e7` |
| Vite `dist/node/chunks/node.js` | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |
| Installed ARM64 candidate `@rolldown/binding-darwin-arm64/rolldown-binding.darwin-arm64.node` | `f5738d2772a6c37175dcbfafd3191575dd047f0c811a8367c48f02b9f1ba5fee` |
