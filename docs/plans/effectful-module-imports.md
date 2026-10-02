# Decision plan: effectful module imports

Status: **planning only; no import policy or architecture selected**. This plan follows the user's approval to split #106 into bounded safe improvements and separately planned handling of effectful module imports. The eleven named Epic callables and their offline mutation proof remain open under [ticket 01](declared-external-calls-tickets/01-analyzer-precision.md); #107 must not start merely because the partial patch passes.

Decision tracking: [#123 — safe handling of effectful module imports](https://github.com/adammedford/replay-lock/issues/123). It is a design decision ticket, not authorization to implement a new import policy.

## Evidence before design

Pinned application: Epic Stack `8473afd804b66dba6a23f317908dc35d1535e90d`. The [partial analyzer evidence](../pilots/analyzer-precision-2026-10-01.md) records the final analysis and exact named-target blockers. A safe fresh-function definition correction exposes other causes instead of making all eleven callables eligible. An eligibility count is not a captured case, offline replay, or mutation-detection result.

Distinct remaining effects must not be grouped as harmless "initialization":

| Source site in the pinned application | Observed construct | Required treatment now |
| --- | --- | --- |
| `node_modules/prismjs/prism.js:1218` | `global.Prism` assignment; browser paths also register listeners and schedule highlighting | Preserve global/scheduling rejection |
| `node_modules/@sentry-internal/replay/build/npm/esm/index.js:4017-4025` | Guarded iframe insertion/removal, global `Array.from` replacement, catch-path `console.debug` | Preserve rejection of every reachable unsafe branch; do not assume the guard always avoids it |
| `app/utils/providers/github.server.ts:44-55`, reached from `auth.server.ts:23` | OAuth-key-dependent logging during provider registration | Placeholders satisfy missing keys but do not prove the logging branch unreachable during capture |
| `node_modules/@noble/hashes/sha3.js:29` | Module-local SHA3 table-construction loop | Separate analyzer precision question; local-looking writes still need alias/escape and unknown-call proof |

These source positions identify evidence at the pinned revision, not permanent package/file allowlists. No actual network or database behavior was needed to establish this blocker map.

## Existing seam and safety contract

Today the public seam is `scan --dev` and `record → review → verify`. [Development recording](../development-recording.md#selection-and-configuration) defines which initialization effects taint every importer and which taint only a declaration. [preflightDevCases](../../src/dev-verify.ts) requalifies current source before [runDevVerificationWorker](../../src/dev-verify.ts) imports a target; [createDevProjectCache](../../src/dev-transform.ts) supplies the shared analysis/transform implementation.

An explicit `replay.environment` is an initialization input, not permission for I/O, logging, DOM mutation or native-global replacement. Fresh processes and browser pages isolate case lifetimes; they are not, by themselves, a proof that native module effects cannot run. A new verification loader alone also cannot unlock live capture while the analyzer correctly rejects a globally effectful import graph.

Any future module at the import seam must keep these invariants:

- No fallback to native network, filesystem reads/writes, databases, scheduling, logging, DOM writes or host/built-in mutation for an application effect that is not explicitly supported and proved. Ordinary infrastructure source loading is not an application-effect permission. No defaults that declare or trust packages automatically.
- Requalify both capture eligibility and replay safety from current physical source and current configured realm/resolve conditions. Configuration changes, source changes, changed guards or capabilities must invalidate the applicable proof before executing the changed graph.
- Preserve the callable's observed arguments, external-read trace and completion. No generated expected results, synthetic direct calls pretending to be application recording, or replacement of stateful objects by invented behavior.
- Keep existing privacy/value/adapter rules and exact comparison. V1 remains unchanged. A new artifact/provenance version, if required, needs a separate compatibility decision; do not silently reinterpret V2 evidence.
- Missing capabilities and unknown branches fail with a named diagnostic before unsafe work. A caught error must not unlatch the safety failure. Test both realms through public CLI/application seams, not private analyzer methods.

## Decisions to make, not permissions granted

| Candidate | Potential leverage | Proof burden / open question |
| --- | --- | --- |
| Prove narrowly supported initializer branches unreachable under explicit, pinned inputs | One analysis rule could retain ordinary imports without allowing the unsafe branch | Can a supported predicate be proved without executing application code or reading secrets? How do live capture and replay share the same proven inputs? Host/global mutation, getters, aliases, changed conditions and opposite branches must refute the proof. Runtime-native assumptions are not automatic policy. |
| Introduce a capability-constrained import module with separate live/replay adapters | Centralizes import-effect handling at one seam rather than scattered package exceptions | Which effects can be prevented before native execution while preserving required initialization and module identities? How are cycles, side-effect imports, exports, conditional resolution and initial state handled? Child-process isolation alone is insufficient. This is a new design, not an already approved sandbox. |
| Keep those graphs ineligible while improving safe owned initialization only | Preserves today's fail-closed behavior and can deliver precise diagnostics | The eleven-callable requirement remains unmet. Document this compatibility boundary explicitly rather than relabeling it as successful application adoption. |

Do not choose a candidate by bypassing analysis, pruning imports whose effects were never proved irrelevant, editing application dependencies, trusting the whole dependency graph, or assuming optional global writes cannot affect a target. Existing planned invocation-time external declarations in #107 do not automatically support module initialization.

## Ordered proof and delivery sequence

1. **Finish the safe partial #106 patch.** Preserve pure/hazard controls, increasing measured floors and the blocked named-target table. Verify/typecheck/dogfood and both extended conformance families; two independent review axes; PR without closing #106.
2. **Write a decision ticket linked to #106/#104.** State the concrete import seam, selected candidate, supported effects/predicates, unsupported shapes, invalidation inputs and required named diagnostics. Obtain an explicit policy/design decision before implementing new import behavior. This document is the input to that decision, not its outcome.
3. **Refute candidates with synthetic fixtures.** Cover module logging, native reads/writes/network, timers/listeners, global/prototype writes, getter-bearing sources, escaped aliases, transitive/side-effect imports, cycles and source/config/profile drift. Include positive controls proving the tests detect actual effects; absence of an invocation is not itself a passing oracle.
4. **Prototype one selected module at the import seam.** First prove a minimal eligible application call and offline replay against a native effect that fails if reached. Compare live/replay equivalence with the baseline, then run the opposite unsafe branch and prove fail-closed rejection. Do not adopt a throwaway prototype as production support.
5. **Collapse the decision and prototype evidence into a spec and tracer-bullet tickets.** Each ticket names its interfaces, blocking edges, unsupported cases and public acceptance tests. If no candidate preserves the safety invariants, retain the compatibility block and bring the evidence back to the user.
6. **Resume named Epic proof only after a verified implementation.** Capture the eight route metadata functions, `getSessionExpirationDate`, `imageHasFile` and `imageHasId` through natural workflows in their actual realm; establish both-realm eligibility. Review, verify with the database removed, pass a behavior-preserving edit, and report bounded logic mutants per callable, including undetected/no-logic cases. New scripted reports keep `humanReviewMs: null`; earlier timings must not be copied to new cases.
7. **Reconcile #106 and only then proceed to #107.** Keep the initial user ceiling at **60000 ms per case** until the user changes it. The mandatory evidence checkpoints after #107 and #108 still require the user even if automated gates pass.

Open decisions: supported initialization effects, proof invalidation, live/replay equivalence, diagnostic/schema compatibility, and whether any candidate can support the named graphs without changing the no-I/O/no-global-effects contract. None is silently settled by this partial delivery.
