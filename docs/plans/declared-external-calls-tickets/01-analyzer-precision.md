# 01: Fix analyzer false positives and let verify import modules that read the environment

## Parent

[declared-external-calls.md](../declared-external-calls.md)

## What to build

Correct three classifications that block pure callables, without changing capture policy. All are in `src/dev-analysis.ts`.

- **`callTier`.** A string method on a `process.env` or `import.meta.env` value, and `.bind` used for feature detection, are effects of the containing declaration, not global effects. Epic's sites are `toast.server.ts:24`, `session.server.ts:9`, `verification.server.ts:10` and bcryptjs `index.js:338`.
- **`supportedShape`.** Accept a function expression bound with `var` or `let` that is never reassigned, and a parameter default naming a module constant that holds literal data. Epic's sites are react-router `redirect` and remix-utils `safeRedirect`.
- **Parameter mutation.** A callee that mutates its parameter blocks only call sites that pass a value the caller did not create in that call.

Add a replay environment for module initialization:
- configured keys with placeholder values, loaded before verify imports a case's module;
- a named diagnostic when module initialization fails for lack of a key.

Epic's server entry loads `.env` through `dotenv/config`, which replay never runs.

## Acceptance criteria

- [ ] Named callables become eligible in both realms and verify offline in the pinned pilot:
  - eight route `meta` functions: seven blocked by session-storage initialization, and signup's blocked by bcryptjs;
  - `getSessionExpirationDate`;
  - `imageHasFile` and `imageHasId`.
- [ ] Each fix has a yield fixture showing the pure case becomes eligible, and a hazard that stays ineligible. The effectful variant of each pattern keeps its reason code, and existing false-safe hazards still hold.
- [ ] `corpus.eligible` and `selfFloor` in `test/fixtures/yield/expectations.json` are updated in the same change; floors only rise.
- [ ] The mutation stage from 00 reports these callables' mutation results. Their low value is recorded, not hidden.
- [ ] `docs/development-recording.md` describes the replay environment.
- [ ] The full gate passes: `npm run verify`, `npm run verify:dogfood`, `npm run conformance:dev -- --extended`, `node scripts/dev-conformance.mjs --family idioms --extended`.

## Blocked by

- [00](00-measure-value.md)
