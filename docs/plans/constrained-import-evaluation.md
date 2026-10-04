# Evaluate all-or-nothing constrained import admission

**Approval history:** the user subsequently approved the retained non-production evaluation and, on2026-10-03, accepted operation-boundary immutable turns: an admitted call may finish on its qualified snapshot after a mid-call edit; detected drift makes the generation terminal before another owner-mediated call, which requires fresh qualification/hosts. This timing amendment does not relax effect permissions, authorize production delivery, change artifacts or establish runtime feasibility. Earlier immediate-invalidation wording below must be read with this amendment. Parent decision: [#123](https://github.com/adammedford/replay-lock/issues/123). Read the [repository research](constrained-import-research.md) and [platform evidence](constrained-import-platform-research.md) first.

## Problem Statement

ReplayLock can decline to record unsupported behavior while the ordinary development host still evaluates that code. Replay preflight protects reviewed callable import, but invocation traces start after module import. Loader hooks do not turn effectful initialization into harmless execution, and the two completed precision experiments unlocked none of eleven named Epic targets. Maintainers need a refutable evaluation of actual pre-evaluation refusal, without changing effect policy or claiming a sandbox.

## Solution

Evaluate a retained, non-production **whole-graph admission module**: either establish current qualification for the complete requested static graph before any of its modules evaluates, then delegate original qualified execution to the host; or refuse the graph without executing any module in it. Separate live and replay adapters must enforce the same proof. No unsupported statement is pruned, emulated or silently permitted. This candidate is prevention-only; it promises no new eligibility or Epic gain.

## User Stories

1. As a developer, I want unsupported graph imports refused before initialization, so that declined recording is not mistaken for effect prevention.
2. As a reviewer, I want the entire entry closure checked, so that a safe target cannot hide an unsafe sibling or dependency.
3. As a reviewer, I want unused export initializers checked, so that binding-local taint cannot disappear at execution time.
4. As a developer, I want admitted initialization preserved, so that callable results still describe the original application.
5. As a developer, I want exports, namespaces and singleton identity preserved, so that aliases do not create duplicate modules.
6. As a reviewer, I want every loader route covered, so that inline, external, virtual and cached paths cannot bypass admission.
7. As a reviewer, I want evaluated bytes tied to qualification, so that a later transform cannot introduce unchecked effects.
8. As a developer, I want live capture and replay to share admission rules, so that replay has no stronger permission.
9. As a reviewer, I want source and resolver drift requalified, so that stale graphs cannot borrow earlier approval.
10. As a reviewer, I want unknown syntax and resource exhaustion rejected, so that a bounded proof is not a blanket trust declaration.
11. As a developer, I want ordinary HTTP/browser workflows retained, so that expected cases are observed rather than manufactured.
12. As a reviewer, I want inspected observations and explicit review, so that no accepted artifact is fabricated.
13. As a reviewer, I want latched native-effect controls outside application catch, so that a swallowed error does not count as prevention.
14. As a developer, I want safe equivalent edits to verify and result mutations to fail, so that digest changes alone do not decide correctness.
15. As a reviewer, I want unsupported cycles, asynchronous loading and native escapes reported, so that missing coverage is visible.
16. As a maintainer, I want configuration execution and trusted infrastructure scope explicit, so that early effects are not excluded retroactively.
17. As a maintainer, I want lost admissions and performance measured, so that stricter refusal is not concealed by a synthetic positive.
18. As a maintainer, I want pinned application blockers kept separate, so that enforcement work is not confused with dependency support.
19. As a user, I want an explicit approval checkpoint before code, so that a research result cannot silently select a production architecture.

## Implementation Decisions

- **Evaluation only.** Implementation awaits explicit approval of this spec. Retain a future experiment outside main; no production PR/merge, effect relaxation, package exception, runtime profile or artifact-schema change is selected.
- **Toolchain and compatibility.** Evaluate Node22.19.0/Vite8.2.2/Vitest4.1.11, matching the audited toolchain. Package engines span >=22.12.0 <23, but synchronous hooks require22.15 or later; this spec neither assumes those hooks on earlier patches nor selects a higher minimum version or expands runtime support. Delivery would need a separate compatibility decision.
- **One shared admission module, host-specific adapters.** Its interface owns current qualification, unsupported reasons, graph identity and whether execution may begin. Existing development scan, natural recording and verification remain external seams; no public loader-management interface is selected.
- **First grammar is deliberately small.** Fresh synthetic Node HTTP and Chromium hosts; application closure contains only static ESM imports/re-exports, primitive immutable constant initialization and synchronous function declarations whose invoked behavior already qualifies under current analysis. No initializer calls, loops, mutable exports, objects with accessors, class initialization, native capability imports, computed property work or unknown control flow. Do not depend on merging either earlier prototype.
- **Finite graph.** At most32 application modules,64KiB per module and256KiB total application source per requested closure. Count original and evaluated representations independently; excessive size, unknown expansion or exhausted analysis is refusal. Limits are evaluation caps, not a new production configuration or proof that the underlying analyzer is cheap. Measure both small and exact-boundary workloads before recommending delivery.
- **Whole closure before evaluation.** Include side-effect imports, re-exports and every initializer—including unused binding-local initializers. Callable eligibility alone is insufficient. Refusal must stop all graph evaluation, not merely prevent a target invocation or remove instrumentation.
- **No suppression or state invention.** Delegated admitted source retains ordinary initialization and export behavior, apart from existing transparent recording instrumentation. No statement deletion, global emulation, replacement table, fake constructor, imported-value copy, module extraction or surrogate effect result.
- **Execution-route coverage is a feasibility gate.** Establish enforcement before Node/Vite inline evaluation, native external evaluation and cache reuse, and before a browser entry is released for evaluation. Initially reject application externals, CommonJS, builtin/data/remote/virtual modules, workers, dynamic imports, cycles and top-level await. These negatives are coverage probes, not supported capabilities. Trusted host-generated runtime modules require an explicit fixed fixture-infrastructure classification; no application path/package is trusted automatically.
- **Bind actual inputs.** Qualification includes exact physical source, resolved host module identities, authored/evaluated bytes, host adapter/proof revision, transforms and runtime versions, aliases/conditions/package metadata, lockfile, realm and configuration identity. Unknown plugin output or a mismatch refuses before evaluation. A later reread of checked paths alone is not an atomic source-binding proof. Do not alter public graph digests merely to tag the experiment.
- **Fresh host and invalidation.** Attach to an already-executed application, arbitrary application configuration/plugins, HMR continuation and reuse of an unqualified module cache are unsupported. Trusted synthetic host setup precedes admission; application module execution does not. Changes close the generation and require current qualification in a fresh application realm/process/page. Preserve normal within-generation module identities rather than cache-busting URLs; differing URLs/queries and ambiguous aliases remain unsupported until separately proved.
- **Effects remain prohibited.** No native application logging, filesystem/database/network, timers/listeners, DOM/global/prototype mutation, getters, proxies or unknown native calls during initialization. Harness source loading, HTTP requests, DOM buttons and observer storage belong to the explicitly controlled test infrastructure, not application-effect permissions.
- **Refusal and provenance.** Scan retains applicable ordinary reason codes. Reviewed unsafe source retains REPLAY_SAFETY_REGRESSION before import; unsupported host placement is reported explicitly. Fresh live refusal must be externally distinguishable from a normal unrecorded call and survive application catch. Diagnostic wording for a new execution refusal is not a selected production taxonomy. Existing privacy/value/adapter/comparison rules and complete-capture requirements remain; no initialization trace is invented in V2.

## Testing Decisions

Use the existing public seams from #125/#126: scan JSON, natural Node HTTP requests/Chromium button clicks, inspected pending observations, explicit synthetic review and offline verify. Confirmation was requested during specification; any alternative or additional seam needs discussion before tests are written. Private helper/AST tests, direct target calls to generate expected cases and fabricated artifacts are not substitutes.

Two ordinary positive fixtures import a safe scalar helper through an ESM diamond/re-export closure and naturally return independent literals7 and9. Controlled application responses separately assert host-native namespace/export-function identity under two imports resolving to the same module, export shape and required initializer-derived values. Compare those public outcomes with the unchanged baseline host; do not introduce a global counter merely to count initialization. If current callable qualification cannot expose a required observation, report the missing seam instead of bypassing analysis or rewriting the target.

| ID | Both-realm scenario | Required public result |
| --- | --- | --- |
| P1 | Minimal effect-free static closure and table-free scalar result | Scan qualifies; natural observed7 is inspected/reviewed and verifies offline |
| P2 | Diamond, named re-export, primitive initialization; second result9 | Natural observed9 is inspected/reviewed and verifies offline; baseline/admitted responses also agree on initialization-dependent values, export shape and identity |
| P3 | Same qualified source through live and replay adapters | Same admission rules, source/resolution identity and original semantics; no replay-only permission |
| H1 | Independently reachable logging/read/write/network/database initializer | Entire graph refuses before evaluation; no native effect reached, no candidate accepted |
| H2 | Timer/listener/DOM/global/prototype initializer | Same; each effect has an independent external positive control |
| H3 | Unsafe dependency, side-effect import, unused export initializer or safe sibling before unsafe module | Whole graph refuses; no sibling begins initialization or invocation |
| H4 | Getter/proxy/coercion, computed key, retained/aliased native call | No syntactic-name-only defense; ordinary refusal before evaluation |
| H5 | Application external/builtin/data/remote/virtual/CJS/worker escape | Refuse without executing native/external/shortcut route |
| H6 | Dynamic import, cycle, top-level await, unknown source, size/budget excess | Explicit unsupported outcome before graph evaluation; no partial proof |
| H7 | Transform inserts an effect; changed externalization or host resolution | Checked authored source cannot authorize different executable bytes/graph |
| H8 | Warm caches, source replacement, symlink/case change, aliases/conditions/config/lock/adapter drift, change between qualification and load | Cold/warm decisions agree; invalidate generation; changed graph cannot execute under stale qualification |
| H9 | Already-running attach, opaque config/plugin, extra browser executable entry or service worker | Unsupported placement reported; no claim that earlier effects were prevented |
| C1 | Safe equivalent edit and independent7→different-result mutation | Equivalent verifies; mutation fails OUTPUT_MISMATCH, not blanket digest inequality |
| C2 | Reviewed positive edited into unsafe initializer | REPLAY_SAFETY_REGRESSION before target/dependency import or invocation; effect latch remains untouched |
| C3 | External effect oracles, including effects caught by application | Every sentinel independently reachable in a throwaway control; latch checked outside catch; descriptor/state restored on all exits |
| C4 | Existing locked suite, packed consumer, dogfood, extended conformance, typecheck and responsiveness | Unweakened gates pass or failures/lost admissions explicitly reported; browser files remain serial |
| E1 | Source-only pinned Epic/Noble comparison | Exact blockers and any independently proved gain reported; no forced admission or unsafe target/config execution |

No admission-negative application module is imported merely to obtain zero counters. Natural negative requests attempt the gate, not ungated evaluation. Oracles must be installed before positive import and stale import attempts; controls execute isolated throwaway effects, not blocked application modules. For graph-wide refusal, pair the hazard with a throw-only prelude carrying a distinctive synthetic marker: the trusted host's outer import catch must distinguish qualification refusal from the prelude exception. That deliberately unsupported prelude is an evaluation witness, not a purported effect-free positive or a generated recording. Its independent throwaway control proves visibility. Do not insert a global counter into a positive initializer to claim effect-free initialization. If infrastructure blocks a required oracle, report the host limitation and do not claim effect-prevention success from another oracle. #126's protected-intrinsic limitation cannot be bypassed by weakening the guard.

### Sequence and exit gates

1. Review research, grammar, exclusions, public seams and source-binding strategy; obtain explicit approval before prototype work.
2. Before expanding behavior, demonstrate a controllable enforcement point in **both** hosts, including inline/external/cache paths and browser entry holding. If unavailable, stop with infeasibility evidence, not a replay-only substitute.
3. Establish baseline native positive semantics and independent negative-oracle reachability. Then implement a retained prevention-only prototype in red/green public slices; report supported/unsupported/failed rows separately.
4. Complete the matrix, bounds, current-source invalidation and live/replay equivalence. Inspect observations before review; no effectful graph admission or manufactured cases.
5. Register every new acceptance file; run all unchanged regression/performance gates and independent Standards/Spec reviews. Report lost admissions separately; do not weaken floors to make strict admission pass.
6. Return retained source, actual results and limits to #123 for an explicit production or next-capability decision. Any persisted qualification/initialization provenance requirement that V2 cannot honestly express is a separate design gate, not silently added here.
7. Keep #106 open and #107 blocked. Only a separately approved/verified capability can resume the eleven-callable pinned application proof. Initial60000ms human ceiling and mandatory later checkpoints remain unchanged.

## Out of Scope

Implementation in this research/spec task; production support, hostile-code sandboxing, execution of effectful initialization, native-I/O fallback, effect suppression, environment/secret facts, dependency/application edits, package/file allowlists, arbitrary plugins/configuration, CommonJS/dynamic/cyclic/TLA graphs, new schema/profiles, V1 changes, merging earlier prototypes and completion of the named application proof.

## Further Notes

The first proposed slice may admit **no additional callables** and may reject more graphs than current recording eligibility. Its success criterion is actual prevention plus preserved admitted semantics, not yield. Platform hooks suggest possible placement but do not establish feasibility; the evaluation must be allowed to conclude remain-ineligible. This spec is not permission to proceed from an enforcement experiment to native-effect emulation.
