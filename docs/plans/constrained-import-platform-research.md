# Constrained imports: platform evidence and limits

Status: documentation research, 2026-10-02. No application module was imported; no runtime experiment, configuration hook, dependency change, or secret read was performed.

## Scope and source pins

The defensible direction is whole-module qualification before evaluation, followed by ordinary execution of an explicitly supported graph. Loading hooks can enforce admission and provide transformed source. They do not establish a hostile-JavaScript sandbox or automatically preserve the behavior of a module whose initialization effects have been removed. This is a recommendation, not an implemented guarantee or evidence of application coverage.

Node evidence is the **v22.19.0 release documentation**, rather than current unversioned documentation. Read-only installed metadata confirms **Vite 8.2.2** and **Vitest 4.1.11** in `/tmp/replaylock-126.HZwZDJ/worktree/node_modules/{vite,vitest}/package.json`, lines 3 and 4 respectively. Vite conclusions were cross-checked against its tagged source and installed distribution: `vite/dist/node/module-runner.js:1017–1026,1161–1273` and `vite/dist/node/chunks/node.js:34291–34361`. Vitest's version is context only; its execution modes have not been qualified here. Browser evidence is the HTML and ECMAScript **living specifications inspected on 2026-10-02**; these describe abstract semantics, not a particular browser release or additional Node 22 capabilities.

## What Node hooks actually intercept

**Evidence.** Node 22.19 has asynchronous `module.register()` hooks on a separate loader thread, and synchronous `module.registerHooks()` hooks, introduced in 22.15.0, on the loading thread. Their operations are `resolve` and `load`, supplying module URLs, formats, and source. Registration must precede the relevant imports; registering in an entry body requires subsequent dynamic import, because static imports run earlier. Synchronous hooks cover `import`, `require`, and `createRequire`; asynchronous CommonJS loading has source-dependent coverage and API limitations. A builtin-format load ignores replacement source. Hook chains run in LIFO order; early completion requires `shortCircuit`. These APIs have release-candidate/active-development stability respectively. [Node 22.19 module API, enabling and hooks](https://nodejs.org/download/release/v22.19.0/docs/api/module.html#customization-hooks), [CommonJS load caveat](https://nodejs.org/download/release/v22.19.0/docs/api/module.html#caveat-in-the-asynchronous-load-hook).

**Inference.** A loader can reject source before evaluation. It does not intercept `object.property`, retained function references, or every native call. Wrapping `fetch` cannot control filesystem APIs, getters, proxies, timers, or alternate references. Redirecting an import to a surrogate substitutes a capability; it requires its own contract.

## Permission and VM boundaries

**Evidence.** Node's permission model is stable since 22.13.0 and enabled with `--permission`. In 22.19 it restricts filesystem, child processes, workers, native addons, inspector, and WASI; the documented set is not a general network denial facility. Existing filesystem descriptors bypass permission checks, worker permissions are not inherited, and pre-initialization file-reading flags have exceptions. Node explicitly treats this as protection against accidental resource use by trusted code, not malicious code. [Node 22.19 permissions and constraints](https://nodejs.org/download/release/v22.19.0/docs/api/permissions.html#permission-model), [exact CLI flag](https://nodejs.org/download/release/v22.19.0/docs/api/cli.html#--permission).

Node's VM documentation explicitly disclaims security isolation. VM contexts provide different globals, and module APIs can separate linking and evaluation; neither fact makes arbitrary imported JavaScript safe. [Node 22.19 VM introduction](https://nodejs.org/download/release/v22.19.0/docs/api/vm.html#vm-executing-javascript), [SourceTextModule lifecycle](https://nodejs.org/download/release/v22.19.0/docs/api/vm.html#class-vmsourcetextmodule).

**Inference.** Permissions and process separation can add containment and cleanup layers for an already-supported subset. They cannot prove that initialization is effect-free, recover secrets after a read, roll back external writes, or repair changed initialization semantics. Hostile code is outside this proposed capability; executing a module to discover whether it is safe defeats pre-evaluation qualification.

## Identity, initialization, cycles, and asynchronous evaluation

**Evidence.** Node ESM resolves and caches by URL; different query strings or fragments can load the same file multiple times. ESM has its own cache, rather than `require.cache`; `data:` modules cannot resolve relative imports. Top-level await is supported, and `require` only supports synchronous ESM graphs. [Node 22.19 URLs](https://nodejs.org/download/release/v22.19.0/docs/api/esm.html#urls), [cache difference](https://nodejs.org/download/release/v22.19.0/docs/api/esm.html#no-requirecache), [top-level await](https://nodejs.org/download/release/v22.19.0/docs/api/esm.html#top-level-await).

ECMAScript's cyclic-module linking and evaluation algorithms track graph state, evaluation errors, cycle roots, promises, and asynchronous dependencies. Import bindings use module environments rather than copies of exported values. [ECMAScript cyclic module records](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-cyclic-module-records), [source-text module initialization](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-source-text-module-record-initialize-environment).

**Inference.** Retaining ordinary source and resolution is the strongest preservation strategy for admitted modules. Export extraction, changed URLs, a second realm, reordered initialization, or stubs can alter singleton identity, live bindings, temporal-dead-zone failures, closure state, error timing, and async completion. A conservative first contract should reject cycles, top-level await, and unresolved dynamic graph expansion unless separately supported and tested. Blanket removal of effectful statements is unsound: a removed assignment can determine a retained export; a removed getter call can initialize state or throw. Preventing the native effect and preserving every original observable behavior are different claims.

## Browser admission must precede evaluation

**Evidence.** HTML separates fetching/linking the module graph from running a module script, whose record is evaluated. Its module map uses URL and module type; cached records are reused. Import-map resolution and host fetch algorithms belong to the browser host; the specified fetch hook is not an ordinary JavaScript effect-interception API. [HTML module graph fetching](https://html.spec.whatwg.org/multipage/webappapis.html#fetch-an-external-module-script-graph), [module script execution](https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script), [module maps](https://html.spec.whatwg.org/multipage/webappapis.html#module-map).

**Inference.** A controlled source-serving seam can hold entry delivery until qualification. A dependency fetch/link refusal also prevents evaluation of a fresh single native static graph, including siblings; do not confuse this with Vite's sequential evaluation or separate entries. Individual request checks still need full source/resolution/cache binding. Calling `import()` and inspecting its namespace is too late. First scope uses a fresh synthetic page; workers and existing pages require separate qualification.

## Vite runner parity is an explicit obligation

**Evidence.** Vite 8.2.2's default evaluator runs inlined transformed code through `AsyncFunction`, awaiting its result, and executes external modules with native `import(filepath)`. [Tagged evaluator, lines 13–47](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/module-runner/esmEvaluator.ts#L13-L47).

The runner manages promises, circular requests, exports, module identity, and invalidation. Its builtin/data paths can bypass transport fetching; external modules take the external evaluator path. [Tagged runner, lines 129–203 and 238–387](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/module-runner/runner.ts#L129-L387).

Server fetching can return an externalization result or call `environment.transformRequest`; bare dependency resolution uses configured external conditions. SSR transformation rewrites imports to awaited runner calls and installs export accessors. [Tagged fetchModule, lines 22–101](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/node/ssr/fetchModule.ts#L22-L101), [tagged SSR transform](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/node/ssr/ssrTransform.ts).

**Inference.** Node load hooks alone cannot qualify source evaluated through Vite's `AsyncFunction`; a Vite transform check alone cannot cover native external imports or runner shortcuts. Qualification must bind the actual resolved graph and evaluated transformed bytes, including generated/virtual modules, conditional exports, externalization, and invalidation. Trusted transform execution is a separate prerequisite: application configuration/plugins must not run merely to discover admissibility. Native Node, Vite runner, browser, and Vitest are separate parity targets; success in one is insufficient.

## Recommendation and refutation gates

Specify a small source grammar and finite dependency graph first. Reject unknown syntax, indirect native capability access, generated code, unqualified externals, and uncertain initializer behavior before evaluation. For the first synthetic launch/page, exclude CommonJS, dynamic imports, top-level await, cycles, and attachment to an already-executed host. Admit only effect-free graphs and preserve ordinary host execution of qualified bytes; suppression rewrites are outside this contract. No broader admission or application gain follows from these platform facts.

The gateway adds value only if it controls every execution path and prevents the complete rejected graph from beginning evaluation. A repeated eligibility check that lets the ordinary host execute rejected modules is merely observation. Vite requires admission before either evaluator path or cache reuse; browser serving requires admission before releasing the entry. Reject unresolved externals, cached modules without matching qualification, and transforms whose outputs cannot be bound to reviewed bytes. These placements are feasibility requirements, not a verified implementation design.

Future fixtures should try to refute the contract; none were executed in this research:

- Put a native effect in an otherwise irrelevant export initializer, getter, computed key, aliased call, and dependency. Rejection must occur before any graph module executes.
- Compare native and admitted execution for export descriptors, closure state, live binding updates, identity under URL aliases, thrown errors, and initialization order.
- Exercise cycles and top-level await, including rejection/hanging cases: either preserve their declared semantics or reject before evaluation.
- Run equivalent graphs across native Node, Vite inlined/external paths, and browser entry/dynamic imports; probe builtin/data/virtual shortcuts and transformed-code changes.
- Populate caches, invalidate source, change conditional resolution, and mutate qualified bytes between analysis and loading. Stale admission must fail closed.
- Verify permission errors and cleanup independently from admission; neither is evidence that the whole graph was qualified.

## Review record

Four passes completed: full evidence-led draft; expert reread of loader and evaluator boundaries; defect hunt for version drift, cache bypass, premature sibling evaluation, and semantics overclaims; final terminology/citation polish. The reread sharpened the distinction between Node hooks and Vite's direct evaluator, and the defect hunt added whole-graph and transformed-byte admission requirements. Remaining limitations: no execution evidence, no browser-version qualification, no Vitest-mode audit, and no measured corpus acceptance or application gain.
