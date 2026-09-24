# Capture application logic behind declared external calls

## Problem Statement

Development capture instruments 19 of Epic Stack's 327 callables in each realm ([epic-blockers-2026-09-24.md](../pilots/epic-blockers-2026-09-24.md)). Of the 308 it skips:

- 122 are outside supported shapes, 110 of them because they render JSX.
- The remaining 186 are blocked mostly by collaborators the callable does not own: unanalyzed package calls, dependency initializers that run when verify imports a module, database queries, session storage and router hooks.
- A skipped callable typically has several independent root blockers. The report's greedy unlock plan resolves one site at a time and reaches only 23 more callables after fifteen fixes.

The cases accepted so far protect little. The three accepted callables are `getUserImgSrc`, `isUser(null) → null` and `meta() → [{ title: "Epic Notes" }]` ([real-app-2026-09.md](../pilots/real-app-2026-09.md)). The pilot's seeded regression replaces every return value with `undefined`. Any case detects that, so a detected regression shows only that a case exists, not that it protects logic.

ReplayLock already handles nondeterministic inputs by recording them. `Math.random()`, clocks, `fetch`, file reads and configured environment keys are traced reads: recording stores what they returned, and replay supplies the same values in order, with no fallback to real I/O ([development-recording.md](../development-recording.md#supported-external-reads)). That mechanism is limited to a fixed catalog.

## Solution

A project declares external calls. A call through a declared binding is recorded exactly like `Math.random()`: its result is an input to the case, its arguments are asserted, and replay never runs it. Most of the testing value comes from the asserted arguments, e.g. the database query a loader builds from its URL parameters.

Delivery comes in slices, each centered on a named Epic callable. A slice is judged by accepted, verified cases that detect seeded logic regressions, not by eligibility counts. Work stops at the slice 2 and 3 gates if the evidence does not support widening.

## User Stories

1. As a developer, I want to declare which calls reach state outside my code, so that functions calling my database or router can be characterized without mocks written by hand.
2. As a developer, I want a declared call's arguments asserted at replay, so that a change to the query a function builds fails verification.
3. As a developer, I want a declared call's recorded result supplied at replay, so that verification needs no database, network or session.
4. As a developer, I want capture to refuse a declared call whose result is not plain data, so that a case never replays a fake object with invented behavior.
5. As a developer, I want capture to refuse a declared call that receives a callback or changes its arguments, so that the recorded result is the call's whole influence.
6. As a developer, I want verification to fail rather than run a real external call when my configuration stops declaring it, so that removing a declaration cannot cause real I/O at verify time.
7. As a developer, I want loaders that read only some of their argument's properties to be recorded with only those properties, so that unused framework context does not block capture.
8. As a developer, I want request cookies never written to case files unless my own code reads them, so that sessions do not leak into the repository.
9. As a developer, I want modules whose initialization reads environment variables to import during verification, so that newly eligible callables do not fail to load.
10. As a reviewer, I want cases that merely return a recorded external result labelled, so that I can skip cases that restate their recording.
11. As a maintainer, I want the blockers report to separate unsupported constructs from fixable blockers, so that planning targets reachable callables.
12. As a maintainer, I want each accepted case scored against seeded logic mutants, so that coverage claims rest on detected regressions.

## Implementation Decisions

### 1. Declared external calls

- Configure as `effects.external: ["<specifier>#<export>", ...]`, next to `effects.environment` ([dev-options.ts](../../src/dev-options.ts)). Specifiers resolve as Vite resolves them. Nothing is declared by default.
- A declared binding may be called directly or through a member chain (`prisma.user.findFirst(...)`). A project helper may be declared, e.g. `#app/utils/auth.server.ts#getUserId`.
- Record through the existing traced-effect path: `devEffect` in [dev-runtime.ts](../../src/dev-runtime.ts) and `TraceEvent` call/return pairs in [dev-contract.ts](../../src/dev-contract.ts). A promise result records its settled value. Replay matches calls in order with exact argument comparison; a mismatch is `TRACE_MISMATCH`.
- Arguments and results must be values the codec supports. Otherwise capture blocks the observation with `UNSUPPORTED_VALUE`.
- These are refused:
  - A function argument is `FUNCTION_VALUE` at analysis.
  - Changed arguments raise `MUTATED_INPUT`, the same re-encoding check applied to a callable's own arguments.
  - Any use of a declared binding other than as a call target keeps its current reason code.
- Intercept declared calls in every instrumented module, so a helper's external calls are recorded in its caller's trace. A declared call inside uninstrumented package code stays `UNINSTRUMENTED_EFFECT`.
- Writes such as `prisma.session.create` or `sendEmail` qualify through a declaration: their arguments are asserted, and replay never performs them.

### 2. Arguments and requests

- When a parameter is a destructuring pattern without a rest element, record only the properties it binds. The body cannot observe the others, and `arguments` is already unsupported. Of Epic's 65 loaders and actions, 58 take `request`; recording the whole argument object would also encode `context.serverBuild`.
- When a value from the callable's own arguments is passed to a declared call, record it as a reference such as `$0.request`, not by value.
- Encode a `Request` argument as its URL, its method, and only the headers that analyzed code reads by literal name. Reading any other header blocks the callable. Existing privacy rules ([sensitive.ts](../../src/sensitive.ts)) still reject `cookie` and `authorization` values the callable reads itself.

### 3. Replay

- The replay transform rewrites every import of a declared binding, in every module the replay graph loads, to a stub. The stub throws if anything touches it outside an intercepted call. A declaring module loads only if a module needs one of its other bindings.
- A case records the declared operations it used. Verification fails with `EXTERNAL_UNDECLARED` when the configuration no longer declares one.
- Provide an explicit replay environment for module initialization, loaded before import. Epic loads `.env` through `import 'dotenv/config'` in its server entry, which replay never runs. `toast.server.ts` evaluates `process.env.SESSION_SECRET.split(',')` when imported. A missing key produces a named diagnostic, not a bare exit 2.

### 4. Analyzer precision (no policy change)

- A call rooted at an uncatalogued global is currently a global initialization effect ([dev-analysis.ts](../../src/dev-analysis.ts) `callTier`). Scope string methods on `process.env` / `import.meta.env` values and `.bind` feature detection to the containing declaration. Epic's affected sites are `toast.server.ts:24`, `session.server.ts:9`, `verification.server.ts:10` and bcryptjs.
- Accept function expressions bound with `var` or `let` that are never reassigned, and parameter defaults that name a module constant holding literal data. Epic's affected sites are react-router `redirect` and remix-utils `safeRedirect`.
- Inherit a callee's parameter mutation only at call sites that pass a value the caller did not create in that call.

### 5. Web platform values and trusted packages

- Add built-in encodings for `Headers`, `Response`, `Request` and `FormData`. Make request body readers traced reads, as fetch response body readers already are. Bump `DEV_CATALOG_VERSION`.
- Development capture honors the existing `trustedPackages` configuration ([trusted-packages.md](../trusted-packages.md)): explicit, version-bound, no built-in entries. A trusted export executes at replay and is not analyzed. This is for deterministic libraries, which should run, not be recorded. Recording `twMerge` would reduce `cn`'s case to "`twMerge` returned X, so `cn` returns X".

### 6. Measurement

- The blockers report classifies each shape code by the construct at its root ([yield-blockers.mjs](../../scripts/yield-blockers.mjs)).
  - JSX, classes, generators, tagged templates, `arguments`, and functions nested in anonymous functions or methods are outside supported shapes.
  - An `await` on an unanalyzed call, a non-`const` binding and a non-literal default are ordinary blockers.
- The pilot adds a mutation stage. For each accepted callable, apply bounded logic mutants one at a time: flipped comparison and logical operators, swapped conditional branches, changed literals, and changed arguments to declared calls. Run verify after each and record detected and total. A callable with no mutable logic is reported as such.
- `humanReviewMs` remains null for scripted reviews. Review time is recorded only in a session with a human participant.
- Report the share of accepted cases whose completion equals one recorded external result.

### Decisions

These were confirmed with the user on 2026-09-24. Each reversal keeps interception with replay proof and needs an explicit per-project opt-in.

| Previous rule | New rule |
|---|---|
| Every function a callable can run is analyzed ([development-recording.md](../development-recording.md#selection-and-configuration)). | Each such function is analyzed or is a declared external call. |
| Writes are ineligible. | Writes are eligible only through declared calls. |
| Arguments are recorded as passed. | Destructuring parameters without a rest element record what they bind. |
| Module code runs natively when verify imports it. | Declared bindings are rewritten at replay. |
| General-purpose I/O interception is out of scope ([development-capture-adoption.md](development-capture-adoption.md#out-of-scope)). | Interception is in scope for declared calls whose arguments and results are data. |
| Hook reads are not portable values ([capture-opportunity.md](../pilots/capture-opportunity.md)). | A hook read whose result is data is portable as a declared call. |

The following are reaffirmed:
- no stateful returned-object replay;
- no closure or function serialization;
- no React element output;
- no built-in trust entries;
- exact comparison by default;
- no fallback to real I/O;
- V1 stays frozen.

Automatic interception of every unanalyzable call was considered and rejected. It would be silent rather than opted into, it records deterministic libraries that should run, and it inflates counts with cases that restate their recording.

## Testing Decisions

- Add hazard fixtures under `test/fixtures/yield/`, where floors only rise:
  - a declared call given a callback;
  - a declared call that mutates its argument;
  - one returning an object with methods;
  - a declared binding used as a value;
  - a stub touched outside a call;
  - an undeclared recorded operation;
  - a rest-pattern parameter;
  - an unlisted header read.

  Each must stay ineligible or fail verification with its named code.
- Prove interception with replay. The yield corpus captures a declared call live, then replays with the real external replaced by a stub that fails if called.
- Every slice runs the pinned Epic application through `scripts/pilot-dev.mjs`. Verify offline with the database file removed. A behavior-preserving edit must pass. Seeded mutants must fail with the expected diagnostic: `TRACE_MISMATCH` for a changed asserted argument, a completion difference for changed logic.
- Keep browser latency inside [responsiveness-budget.json](../pilots/responsiveness-budget.json), measured with `scripts/bench-dev-browser.mjs`. Hooks record on every render, and twice under React StrictMode.
- Finish each slice with `npm run verify`, `npm run verify:dogfood`, `npm run conformance:dev -- --extended` and `node scripts/dev-conformance.mjs --family idioms --extended` on Node 22.

## Out of Scope

- JSX components and render output, classes, generators, closure and function-value serialization, and objects with behavior (sessions, fetchers, `useState` setters).
- Declaring externals automatically, shipping built-in declarations or trust entries, or changing application dependencies to manufacture coverage.
- Detecting drift between a recorded result and the external's current behavior. Recorded results go stale as fetch recordings do; re-recording is the remedy.
- Result projection, opaque values passed between declared calls, and `console` as a declared write. Consider these only if a slice's evidence requires them.

## Further Notes

Tickets live in [declared-external-calls-tickets/](declared-external-calls-tickets/README.md).

The Epic figures come from blocker analysis, which records one origin per reason code per callable. Counts of callables a fix would unlock are therefore upper bounds. Each capability is first measured through a report-only `yield:dev --external <spec>` option before transform, runtime or replay work starts. Configuring an external in the project before its runtime support lands would instrument calls that nothing records.
