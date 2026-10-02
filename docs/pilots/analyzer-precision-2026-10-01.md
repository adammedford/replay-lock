# Partial analyzer precision evidence — 2026-10-01

This is a bounded partial delivery for [#106](https://github.com/adammedford/replay-lock/issues/106), not completion of its eleven-callable application proof. The user approved preserving that proof as open work and separately planning effectful module imports in [#123](https://github.com/adammedford/replay-lock/issues/123). The [decision plan](../plans/effectful-module-imports.md) selects no new import policy. #107 remains blocked.

## Safe improvements and controls

- Initialization string methods on environment values are scoped to their declaration. Host-function binding requires a supported host identity and a strict `typeof ... === "function"` feature guard. Unknown custom bindings and aliased native-function overrides remain blocked.
- Unreassigned `var`/`let` function bindings and defaults naming module constants initialized with inert literal data are supported. Reassignment, mutable defaults and effectful defaults remain unsupported.
- Callee mutation is not inherited when affected arguments are proved freshly owned throughout. Nested borrowed values, replaced aliases, escaped containers, reassigned aliases/parameters, callback-installed values and destructuring defaults remain blocked. Rest/spread argument alignment and unknown mutation origins are conservative, not ownership proofs.
- `Object.assign` may define a direct fresh function/object/array from plain own data sources. Accessors, custom target prototypes, prototype-changing source keys and setter-bearing targets remain blocked; no package/file exception was added.
- Explicit synthetic `replay.environment` strings are loaded before import. Invocation reads still consume their recorded trace, not placeholders. Node `process.env` import failures and authored-module `import.meta.env` failures in both realms name missing keys without exposing values. Optimized/external dependency `import.meta.env` failures retain ordinary infrastructure diagnostics; this part of #106's broader diagnostic requirement remains limited. Invalid maps, accessors, symbols, prototype keys and runtime-managed keys are rejected.

Public yield and verify-CLI controls established behavioral failures before their fixes, including inherited setters, rest/spread alignment, reassigned aliases, mixed transitive origins, installed borrowed values, destructuring defaults and short-circuited primitive environment expressions. V1 and capture policy remain unchanged. No automatic trust/declarations, application dependency edits, blanket initializer skipping or native-I/O fallback were introduced.

The synthetic yield corpus's exact eligible set increases from **41 to 47 per realm**. A fresh self-analysis with Vite's default development conditions measures **129 eligible callables per realm**; `selfFloor` rises from **114 to 129**, without reducing existing floors or removing hazards. These are eligibility measurements, not application-value evidence.

## Pinned Epic compatibility result

Application revision: `8473afd804b66dba6a23f317908dc35d1535e90d`. The retained application's loaded Vite/ReplayLock configuration was used for a fresh Node/browser analysis. It finds **20 eligible callables per realm**, but **zero of the eleven required targets**. Every named target below remains `EFFECTFUL_INITIALIZATION`.

| Target | Node root | Browser root |
| --- | --- | --- |
| `app/root.tsx#meta` | Noble `sha3.js:29` | Sentry replay `index.js:4019` |
| `app/routes/_auth/forgot-password.tsx#meta` | Prism `prism.js:1218` | Same |
| `app/routes/_auth/login.tsx#meta` | Noble `sha3.js:29` | Sentry replay `index.js:4019` |
| `app/routes/_auth/onboarding/$provider.tsx#meta` | Noble `sha3.js:29` | Same |
| `app/routes/_auth/onboarding/index.tsx#meta` | Noble `sha3.js:29` | Same |
| `app/routes/_auth/reset-password.tsx#meta` | Noble `sha3.js:29` | Sentry replay `index.js:4019` |
| `app/routes/_auth/signup.tsx#meta` | Prism `prism.js:1218` | Same |
| `app/routes/users/$username/notes/$noteId.tsx#meta` | Noble `sha3.js:29` | Sentry replay `index.js:4019` |
| `app/utils/auth.server.ts#getSessionExpirationDate` | `app/utils/auth.server.ts:23` | Same |
| `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile` | Noble `sha3.js:29` | Same |
| `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId` | Noble `sha3.js:29` | Same |

Package paths are under `node_modules`: Noble `@noble/hashes/sha3.js`, Prism `prismjs/prism.js`, and Sentry `@sentry-internal/replay/build/npm/esm/index.js`. Analysis preserves one origin per reason code per callable; fixing that origin can expose another independent blocker. The Node metadata roots moved from Sentry's fresh-function definition at `@sentry/node/build/esm/integrations/tracing/redis.js:78` to Noble's loop, not to eligibility.

Primary-source inspection distinguishes precision limitations from genuine effects:

- Noble's `sha3.js:29` starts local table construction. Proving its ownership and unknown-call safety is a separate precision question.
- Prism `prism.js:1218` writes `global.Prism`; browser/worker paths also replace `_self.Prism`, register listeners and schedule highlighting. This is not merely a harmless grammar-table IIFE.
- Sentry replay `index.js:4017–4025` conditionally inserts/removes an iframe and replaces global `Array.from`, with catch-path `console.debug`. A branch-unreachability proof would require an explicit design decision, not an assumption that native behavior always skips it.
- Auth registration at `auth.server.ts:23` calls `getAuthStrategy`; `providers/github.server.ts:44–55` logs when OAuth keys are absent. Placeholders alone do not establish capture eligibility or authorize ignoring that branch.

No new named Epic capture, offline replay, behavior-preserving replay or per-callable mutation result is claimed. The measured application-value gain for these eleven targets is therefore **none yet**. Earlier participant review evidence is separate and must not be attached to new cases; new scripted timings remain `humanReviewMs: null`. The initial human ceiling remains **60000 ms per case**, and user checkpoints after #107 and #108 remain mandatory.

## Verification contract

Delivery requires `npm run typecheck`, `npm run verify` (including the packed consumer and every locked acceptance file), `npm run verify:dogfood`, and both extended conformance families. The new browser-backed acceptance file is registered in the serial browser pass, not omitted to obtain a green result. Final command outcomes and independent Standards/Spec reviews belong in the partial PR evidence. None of those checks substitutes for the still-open named application proof.
