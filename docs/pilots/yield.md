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
