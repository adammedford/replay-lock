# Development capture yield fixtures

`corpus/` is a small application written the way ordinary TypeScript is written: string, array and number helpers, lookup tables, JSON and URL helpers, a schema library, a CommonJS UI library, a router package with custom export conditions, a bundled class-merging library with namespace objects, `#` subpath imports, a stylesheet import and module-scope state. `corpus/packages/` is installed as the fixture's `node_modules` at test time.

`false-safe/` holds one replay hazard per export: effects hidden in implicitly invoked functions or callbacks, untraced host state, mutable or accessor-backed tables, environment snapshots, prototype patching, and effectful module initialization.

`expectations.json` is checked by `test/acceptance/dev-yield.test.mjs`:

- `corpus.eligible` is the exact eligible set per realm. A change that makes more ordinary code capturable updates this list in the same pull request.
- `corpus.samples` are arguments for eligible corpus functions. Each sample is captured live and replayed with native randomness, clocks and fetch disabled; the completions must match.
- `falseSafe.rejected` maps every hazard to the reason codes that may reject it. Each hazard must stay ineligible in both realms and report at least one listed code. Never remove a hazard to make a change pass; a hazard moves only when a reviewed change intercepts it and replay proves that.
- `selfFloor` is the minimum eligible count when this repository analyzes itself. Floors only rise.

`npm run yield:dev -- --root <project>` prints the same eligibility and reason-code histogram for any project.
