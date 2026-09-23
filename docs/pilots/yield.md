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
