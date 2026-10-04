# #127: evaluated binding and ordinary isolated replay

Research only, against retained baseline `dcce94f88ea9f669cd7269a5f5bb4addca09c939`.
G1B remains unmet. The approved immutable authored turn is insufficient to bind
the executable representation. No implementation or feasibility claim follows.

## Evidence and citation scope

Sources are installed first-party distribution code, read without importing it.
`node_modules` resolves to `/Users/adammedford/Projects/IsPure/node_modules`;
package manifests identify Vite8.2.2, Vitest4.1.11, `@vitest/browser`4.1.11 and
`@vitest/browser-playwright`4.1.11. Below, paths beginning `vite/`, `vitest/` or
`@vitest/` are relative to that physical dependency directory. Line references
belong to these installed distributions, not upstream TypeScript. No GitHub
commit correspondence was established, so no speculative source links are given.
Scope/timing come from [evaluation](constrained-import-evaluation.md),
[owned turns](constrained-import-owned-turn-results.md) and
[controller delivery](constrained-import-controller-delivery-results.md).

## What receives executable code

**Node replay evidence.** ReplayLock selects `pool:"forks"`, creates an explicit
project and calls ordinary `startVitest`; the generated harness dynamically
imports each artifact's module (`src/dev-verify.ts:287–332,376–390`). Vitest's
worker transport receives `rpc().fetch(...)`; a cached-file result is converted
to code by `readFileSync(result.tmp,"utf-8")`
(`vitest/dist/chunks/startVitestModuleRunner.DB-7oCpn.js:668–717`). The inherited
Vite runner passes `fetchResult.code` to its evaluator
(`vite/dist/node/module-runner.js:1227–1273`). Vitest wraps that string in an async
function, then invokes `vm.runInThisContext` for the ordinary non-VM worker
(`vitest/dist/module-evaluator.js:163–206`). Native externals instead reach
`import(file)` (`vitest/dist/module-evaluator.js:70–83`). This is the final evaluator boundary;
an authored load hook is earlier.

**Browser replay evidence.** Browser Mode builds another Vite server, copies
project plugins, then adds browser/interceptor/coverage plugins
(`@vitest/browser/dist/index.js:7898–7955`). Playwright opens its page with
`goto`, rather than evaluating application modules through the Node evaluator
(`@vitest/browser-playwright/dist/index.js:1159–1164`). For the standard client
module route, Vite obtains `environment.transformRequest(url)` and sends
`result.code` (`vite/dist/node/chunks/node.js:25191–25218`); `send` may append
sourcemap comments before `res.end(content)` (`19688–19718`). Therefore the
browser's executable response body, including that deterministic decoration, is
the delivery boundary for this route. **Inference:** browser-native module/cache
ownership also needs fencing; these reads do not prove every browser route.

## Ordering and shortcuts

Vite groups plugin `enforce` (`vite/dist/node/chunks/node.js:36944–36956`) and separately sorts each
hook's `order` (`30578–30598`). `load` stops at the first non-null result
(`30870–30896`); transforms run sequentially, replacing code
(`30900–30955`). After all plugin transforms, Vite can still apply `ssrTransform`
(`20671–20712`). Vitest then decorates the resulting source/map
(`vitest/dist/chunks/cli-api.CnMVyzaz.js:1174–1214`). A last plugin transform is
therefore not an exact Node executable-byte gate.

Vite serves pending/memory/soft-invalidated transforms before loading again
(`vite/dist/node/chunks/node.js:20550–20609`) and can return HTTP304 before transforms
(`25122–25143`). Vitest's fetcher returns cached/external results before its
transform fetch and optionally restores filesystem-cache output
(`vitest/dist/chunks/cli-api.CnMVyzaz.js:973–1045,1090–1138`). Its worker also shortcuts builtins,
mocks and cached requests (`vitest/dist/chunks/startVitestModuleRunner.DB-7oCpn.js:684–710`);
Vite's runner can return an evaluated promise (`vite/dist/node/module-runner.js:1170–1175`).
These paths cannot be certified by observing a `load` invocation.

The retained gate returns authored strings and exempts its generated harness
(`scripts/prototype-import-generation.mjs:64–108`); it neither observes final
code nor brackets replay import/invocation with its turn owner. ReplayLock keeps
that project plugin during replay filtering (`src/dev-verify.ts:340–347`), but
retention is attachment of an authored provider, not executable binding.

## Smallest next candidate and refutation

**Required integration, inference:** keep ordinary CLI verification, its forks
pool and Browser Mode. Attach the same generation owner before the harness's
application import; pre-materialize the whole resolved transformed closure before
any application evaluation. Bind the exact Node evaluator input (including tmp
reads), the browser final response representation, and allowed cache reuse to
that immutable proof. Refuse application externals/shortcuts and recreate hosts
on terminal drift. Per-module checking at execution is insufficient: an earlier
sibling could already execute.

**Decision:** choose how trusted instrumentation/SSR/browser rewrites are proved
equivalent or qualified. Their injected imports, calls and export machinery do
not fit the authored primitive grammar. Accepting all transformed code as
infrastructure would defeat H7. The installed internal transport/evaluator
locations are evidence, not a selected supported adapter API. Any worker bridge,
new protocol, persisted proof or artifact field requires explicit discussion.

**Candidate oracle at approved seams:** scan a safe closure; use natural
HTTP/button positives to inspect complete actual candidates, explicitly review,
then run ordinary verify. In fixed synthetic infrastructure, insert a later
effect transform and separately change transformed resolution/externalization;
require refusal before the independently controlled external latch or throw-only
prelude witness. Repeat cold/warm, safe-equivalent and output-mutation controls.
Warm behavior must not borrow an old proof. No negative or drift candidate is
accepted. If observing tmp/evaluator identity requires an additional seam, report
that missing oracle before writing tests.

Four passes completed: factual draft, expert read, defect hunt, claim polish.
No tests, builds, imports, application restoration or runtime probes were run.
Unknowns include supported attachment API, complete routes/cache fencing,
transform equivalence, resolver identity and mid-turn V2 provenance.
