# #127: generation-owning placement evaluation

Status: **source-grounded design evaluation**, retained outside main. The user
approved evaluating this replacement placement on2026-10-03. No new adapter code,
client protocol, production loader interface, profile or artifact change has been
implemented. This is not a completed runtime feasibility result.

The [load-only experiment](constrained-import-cache-results.md) already showed
stale execution in warm Node and Chromium generations, including a fresh page
served by a warm server. Three independent four-pass designs below agree that
ownership must extend beyond a plugin and that source-change timing needs an
explicit contract. The approved [spec](constrained-import-evaluation.md) remains
authoritative; its earlier local approval paragraph is historical, while the
GitHub issue records subsequent user approvals.

## A: minimal snapshot and lease

An internal module would expose `openGeneration(request)`, `dispatch(lease,event)`
and `closeGeneration(lease)`. Opening qualifies the complete graph, binds authored
and evaluated bytes and creates a fresh application realm. Dispatch imports and
invokes inside the owner; no namespace or callable escapes. Closure is terminal
and awaits cleanup. An unsupported graph, source drift, revoked lease or missing
placement proof refuses rather than becoming an unrecorded ordinary call.

This has high depth and good locality: three operations hide qualification,
resolution, caches, disposal and recording instrumentation. Its weak point is the
distributed lease. Permission obtained by the browser does not make a later
invocation atomic with an unrelated filesystem writer.

## B: configurable runner/evaluator ownership

An internal `prepare(entry,realm)`, `dispatch(generation,operation)` and
`retire(generation,reason)` would compose source, host and transport adapters.
The Node adapter owns both runner transport and evaluator; browser delivery owns
the page and server; replay attaches equivalent enforcement to the actual Vitest
worker and Browser Mode project. Callers cannot inject arbitrary transforms,
native importers or approval callbacks.

This offers the most flexibility and localizes version-specific routes, but costs
the broadest implementation and conformance effort. Evaluator interception still
misses already-returned exports. Clearing caches or closing transport cannot
retract a function already retained by a page.

## C: owned fresh workflow

An internal `runOwnedWorkflow({sourceRoot,realm,workflow})` would own a finite,
fixed trusted HTTP/browser workflow from launch through disposal. It returns
public outcomes and cleanup diagnostics, not an executable application capability.
Every generation gets a fresh child process, server and non-persistent browser
context/page. Application source is served exclusively from a qualified snapshot;
no fallback filesystem read, cross-generation native cache, extra executable entry
or application HMR is permitted.

This is the strongest first evaluation candidate for the common caller. It hides
all independently reusable caches, permits the least continuation and reuses the
existing isolated-verification workflow rather than inventing a substitute replay
host. Its narrowness is intentional, not broader development-host support.

| Design | Depth and locality | Principal cost or remaining gap |
| --- | --- | --- |
| A: snapshot/lease | Small interface; centralized proof and lifecycle | Cross-host lease cannot alone exclude unmanaged edits |
| B: runner/evaluator | Flexible internal adapters for live/replay routes | Version-sensitive attachment and escaped-capability control |
| C: fresh owned workflow | Simplest caller; caches and lifecycle wholly hidden | Freshness still does not define source-change timing |

Recommendation: start with C's fresh-host ownership and A's sealed source/proof
representation; keep B's evaluator/transport interception as internal machinery
only where needed. Do not add a general public loader-management interface.

## Source evidence checked by the driver

Installed Vite8.2.2 `dist/node/chunks/node.js:11837–11843` retains
`server._ssrCompatModuleRunner`; `:34338–34343` can return `{cache:true}` before
another transformation. `dist/node/module-runner.js:1170–1175` returns an evaluated
promise before the evaluator runs; `:1207–1224` handles builtin/data shortcuts and
transport cache results; `:1023` delegates externals to native import. These are
separate obligations, not routes controlled by one load hook. Tagged upstream
source and its limits are recorded in the [platform audit](constrained-import-platform-research.md).

ReplayLock already spawns isolated verification children in
[`src/dev-verify.ts:144–184`](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-verify.ts#L144-L184)
and loads project configuration inside the worker at318–326. A fresh worker does
not make arbitrary project configuration trusted. Fixed fixture infrastructure
remains mandatory.

Installed `@vitest/browser-playwright`4.1.11 (with Playwright1.63.0) in
`dist/index.js:1074–1086` reuses contexts by session ID. The driver verified this
route without assuming a new page owns the server's transform cache.

Grammar/proof work is in-process. Real local filesystem, Vite/Vitest and Chromium
hosts must provide eventual feasibility evidence. The trusted HTTP/browser bridge
is remote but owned. Mock adapters could test a protocol, not establish executable
route coverage. No runtime/configuration/application execution was performed in
this design evaluation.

## Unresolved source-change contract

The approved H8 requires cold/warm agreement and invalidation so changed graphs
cannot execute under stale qualification. No reviewed design establishes that
requirement for arbitrary unmanaged writes during active browser execution.

Counterexample: the owner qualifies a graph and grants a browser turn; an unrelated
writer replaces source; before any watcher/revocation message arrives, the browser
calls a previously delivered function. Serving immutable checked bytes prevents
the *replacement* bytes from entering execution, but does not instantly revoke
the old generation. Moving a checksum closer to invocation leaves an interleaving;
acknowledged shutdown occurs later. This is a concurrency/authority gap, not a
claim that all possible ownership mechanisms are impossible.

Two contracts must not be conflated:

1. **Operation-boundary snapshot:** each turn is admitted against a complete
   source-bound generation; an admitted turn may finish on those immutable bytes.
   Detected drift makes the generation terminal before another owner-mediated
   turn, and a later turn needs fresh qualification and hosts. This must explicitly
   define linearization, the authoring-source provider, coherent snapshot capture,
   unmanaged-write handling and observation currentness. It is a proposed contract,
   not an assertion that the existing H8 already accepts it.
2. **Immediate unmanaged-write revocation:** no already-admitted turn may continue
   after any external edit. This needs enforceable write ownership/exclusion and
   actual cross-host execution fencing. Watchers, advisory leases, checksums and
   fresh contexts alone are not such proof. No mechanism has been demonstrated.

Selection between these is needed before code relies on weaker timing semantics.
No temporal relaxation is selected here. G1B stays unmet, earlier failure probes
remain intact, admission expansion stays stopped, #106 remains open and #107
blocked. Native-effect controls, final evaluated-source binding, isolated-worker
parity and the remaining matrix are still outstanding.
