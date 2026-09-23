# Development capture yield

`npm run yield:dev -- --root <project>` reports how many callables development capture can instrument and, for the rest, the share of skipped callables carrying each reason code. `test/acceptance/dev-yield.test.mjs` enforces the fixture expectations described in [the yield fixtures](../../test/fixtures/yield/README.md). Each analyzer change that affects eligibility records its before/after counts here.

## P0: implicitly invoked functions (development catalog 1)

Before this change, any function value in a capture target was invisible to analysis and instrumentation. `String({ toString() { writeFileSync(...) } })` was eligible, and `verify` would have performed that write; so were `String({ toString: Math.random })`, `String({ toString: process.exit })`, `process.argv` and `process.platform` reads, and generator-backed iterators. Unanalyzed nested functions and function values now report `FUNCTION_VALUE`; untraced host reads report `AMBIENT_STATE`.

| Project | Before (`main`) | After |
|---|---|---|
| Replay hazard fixtures (34 hazards) | 14 hazards eligible | 0 eligible |
| Ordinary code corpus (33 callables) | 8 eligible | 8 eligible |
| This repository (818 callables, each realm) | 6 eligible | 6 eligible |

The change removes no ordinary eligible callable in the corpus or this repository. The dominant exclusions in this repository remain module initialization (94% of skipped callables) and unknown calls (92%); later changes target those.

Analysis time for this repository (both realms, median of five runs, three alternating main/branch rounds on one host) stayed within ±4% of `main`; build-local memoization of built-in identities offsets the added checks.

## P1: deterministic built-ins (development catalog 2)

Development analysis accepts `JSON`, `Object` and `Array` statics, `Date.UTC`, URI encoding, and `new Map`, `Set`, `URL`, `URLSearchParams` and `RegExp` when no argument can run user code: no reviver, replacer or mapping function, no spread, and `Object.freeze` only as literal syntax so argument-mutation analysis sees it. At module scope, these calls initialize safely only from literal data or constants holding it. A lookup table such as `new Map([["low", 1]])` no longer marks every function in its module as effectful.

| Project | Before (P0) | After |
|---|---|---|
| Replay hazard fixtures (43 hazards, 9 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (33 callables) | 8 eligible | 12 eligible |
| This repository (818 callables, each realm) | 6 eligible | 11 eligible |

Reading a module table from a function still reports `AMBIENT_STATE`; immutable tables are the next change.

## P2: immutable lookup tables

A function may read a module-private constant that holds flat literal data (a record or array of primitives, `Object.freeze` of one, or a `Map` or `Set` of primitives) when every reference in the module only reads it: member reads that are not written, called, or taken through `__proto__`, `constructor` or `prototype`; `in`; iteration; spreads; and the `Object` key/value readers, `JSON.stringify` and `Array.from`. Returning, passing, aliasing, exporting, or writing the table, including through a cast or destructuring, still reports `AMBIENT_STATE`. `Map` and `Set` tables become readable once their methods are supported.

| Project | Before (P1) | After |
|---|---|---|
| Replay hazard fixtures (57 hazards, 14 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (33 callables) | 12 eligible | 14 eligible |
| This repository (each realm) | 11 eligible | 11 eligible |

## P3a: import resolution

Package `exports` and `imports` use the Vite host's per-environment development conditions (`module`, `browser` or `node`, and `development` by default); inactive conditions such as `module-sync` or `react-server` are skipped as Vite skips them, and analysis without host conditions keeps failing closed. `#` subpath imports resolve through the importing package's `imports` field. Asset imports and `?url`/`?raw`/`?inline` imports are inert; a function that reads a value they bind, or any import whose module or export does not resolve, reports `UNKNOWN_MODULE` at that reference.

| Project | Before (P2) | After |
|---|---|---|
| Replay hazard fixtures (62 hazards, 5 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (33 callables) | 14 eligible | 15 eligible |
| This repository (each realm) | 11 eligible | 11 eligible |

Resolving more packages can move a function from `UNKNOWN_MODULE` to `EFFECTFUL_INITIALIZATION`: the corpus router package now resolves and its module-scope `window` write is analyzed. Reference-scoped initialization is the next change.

## P3b: built-in integrity guard

Recording and replay now check that the built-ins analysis relies on are the engine's own: the properties of core prototypes, iterator prototypes, and the `Math`, `JSON`, `Object`, `Array`, `Number`, `String`, `Boolean`, `Date`, `Map`, `Set`, `RegExp`, `Promise`, `URL` and `URLSearchParams` objects, and the global bindings for them and the URI and number-parsing functions. A replaced, added, or removed property, or a non-native function when the runtime loads (Node's JavaScript `URL` classes excepted), blocks capture with `INTRINSIC_MODIFIED` and fails replay with exit `2`. `Math.random` and `Date.now` are exempt as traced effects. A full check costs about 20 µs on an Apple M4 Pro, so capture checks once per synchronous run; replay checks every case. Eligibility is unchanged.

## P3c: reference-scoped module initialization

Module initialization no longer taints every function in a module and everything importing it. A global effect (I/O, logging, timers and listeners, `import()`, top-level `await`, writes to built-ins, prototypes, or host globals, and side-effect imports of such modules) still does. An unbound statement taints its module and references to its bindings. An effect inside one declaration's initializer taints only references to that declaration, followed through other initializers, re-exports and namespace imports. Unresolved named imports taint only their references.

Two decisions made here are recorded for review: writes to conventionally private global names (`window.__version`, `$RefreshReg$`) are module-wide rather than global, because capture targets cannot read uncatalogued globals; and a literal CommonJS `require("x")` is treated like a call to an imported function, so the required module's own initialization is not analyzed (it runs natively at verify, as the rest of module initialization does).

| Project | Before (P3a) | After |
|---|---|---|
| Replay hazard fixtures (74 hazards, 12 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (33 callables) | 15 eligible | 18 eligible |
| This repository (each realm) | 11 eligible | 14 eligible |

The corpus gains `getUserImgSrc` beside a CommonJS UI library, `displayName` beside a schema definition, and `double` beside `const startedAt = Date.now()`. Their offline replay samples import those modules, whose initializers run natively without affecting the recorded completion.

## P4a: built-in methods and pure callbacks (development catalog 3)

Built-in methods are allowed by name on data receivers, with mutating methods limited to values the invocation created and `test`/`exec` limited to non-global, non-sticky local expressions. Inline synchronous callbacks are analyzed as part of their caller: traced effects inside them, or calls from them to effectful project functions, report `CALLBACK_EFFECT`; writes are limited to the caller's locals and owned values. Targets that use these methods, or built-ins that invoke argument methods, refuse Value Adapter instances at record and verify. A new conformance family replays these idioms offline in Node and Chromium under all three settlement schedules.

| Project | Before (P3c) | After |
|---|---|---|
| Replay hazard fixtures (86 hazards, 12 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (40 callables) | 18 of 33 eligible | 36 of 40 eligible |
| This repository (each realm) | 14 eligible | 36 eligible |

The corpus gained seven ordinary list and string helpers in this change; all are eligible. The four remaining corpus exclusions are a function that reads a clock-initialized binding, a React-style hook that passes a function to library code, a meta arrow with a destructured parameter, and a helper that calls into a router package with module-wide initialization.

## P4b: traced effects inside callbacks (development catalog 4)

Allowed callbacks run synchronously inside their caller, so the transform now intercepts their effects, and calls to project functions from them, against the caller's frame. `CALLBACK_EFFECT` is retired. Four former hazards (`Math.random` in a map callback or sort comparator, an effectful replacer, a callback calling an effectful helper) are eligible and must replay offline with native randomness and clocks disabled; the conformance idiom family replays them in Node and Chromium.

| Project | Before (P4a) | After |
|---|---|---|
| Replay hazard fixtures | 86 rejected | 82 rejected, 4 intercepted and replayed offline |
| Ordinary code corpus (40 callables) | 36 eligible | 36 eligible |
| This repository (each realm) | 36 eligible | 36 eligible |

## P5: parameter patterns and literal defaults

Destructuring parameters and inert literal defaults are supported. Function declarations and expressions already record `arguments`; arrows with patterns or defaults take synthetic parameters that preserve `length` and rebind the original patterns inside the capture wrapper, including nested replay exports. Computed pattern keys and non-literal defaults stay `UNSUPPORTED_CALLABLE`.

| Project | Before (P4b) | After |
|---|---|---|
| Replay hazard fixtures (85 rejected, 3 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (43 callables) | 36 of 40 eligible | 40 of 43 eligible |
| This repository (each realm) | 36 eligible | 38 eligible |

The three remaining corpus exclusions each observe module-scope effects or pass a function to library code.

## P6: namespace objects and built-in key readers

The first Epic Stack scan after P5 (2026-09-23) still skipped `getUserImgSrc` for `EFFECTFUL_INITIALIZATION`, and its diagnostic named two library initializers. Both were read as global effects, so they tainted every module importing the library:

- tailwind-merge 3 builds namespace objects as `Object.freeze(Object.defineProperty({ __proto__: null, ... }, Symbol.toStringTag, { value: "Module" }))`. Defining, freezing or sealing properties of an object the expression itself creates now taints only that declaration. The object and descriptors must be plain literals, keys literals or well-known symbols, so no getter or setter runs. `Object.assign` and descriptors held in bindings stay global.
- react-router 7 snapshots `Object.getOwnPropertyNames(Object.prototype)`. `Object.keys`, `getOwnPropertyNames`, `hasOwn` and `isFrozen` run no getters, so reading a built-in object with them taints only that declaration, as `Date.now()` does. `Object.values` and `entries` of a built-in object stay global.

| Project | Before (P5) | After |
|---|---|---|
| Replay hazard fixtures (90 rejected, 5 new) | 0 eligible | 0 eligible |
| Ordinary code corpus (45 callables) | 40 of 43 eligible | 41 of 45 eligible |
| This repository (each realm, `--defaults`) | 38 eligible | 114 eligible |
| Epic Stack at `8473afd` (each realm) | 9 eligible | 19 eligible |

This repository gains most: frozen limit records such as `Object.freeze({ bytes: 256 * 1024 })` are not flat literal tables, so they had tainted every importer. The corpus gains a helper beside a tailwind-merge-like package; its `cn` wrapper stays excluded.

On Epic, the private-global decision from P3c (D2) accounts for all ten new callables: react-router writes `window.__reactRouterVersion`, and with that write treated as global Epic stays at 9. None of the ten reads the global, which capture targets cannot do. The new callables are `getUserImgSrc`, `getNoteImgSrc`, `getDomainUrl` and `getReferrerRoute` (`misc.tsx`), `isUser`, `parsePermissionString`, `userHasPermission` and `userHasRole` (`user.ts`), the marketing `meta` export and `getWebAuthnConfig`.
