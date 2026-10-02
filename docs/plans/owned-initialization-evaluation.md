# Evaluate closed owned table initialization

## Problem Statement

Parent decision [#123](https://github.com/adammedford/replay-lock/issues/123); related unfinished application proof [#106](https://github.com/adammedford/replay-lock/issues/106). The user selected investigation and a bounded public acceptance spec for owned initialization, not implementation or effect-policy relaxation. The scalar branch experiment [#125](https://github.com/adammedford/replay-lock/issues/125) passed synthetic controls but unlocked none of eleven named Epic targets.

Noble's local-looking table construction is a precision question, not evidence that all its operations are harmless. Ownership alone does not prove method identity, absence of prototype setters, iterator behavior, constructor identity or imported-call safety. This evaluation must test a defensible closed subset and report whether it has any application value.

## Solution

Evaluate a retained, non-production prototype that can qualify a closed numeric table construction and its subsequent stable primitive lookups through the existing public development scan and natural record → review → verify workflows. No configuration option grants permission to native effects. Unsupported code keeps ordinary analysis; no package/file exceptions or application rewrites.

This ticket's first slice is deliberately narrower than actual Noble. Passing it does not promise Noble admission, the eleven-callable proof, a production merge or continuation into #107. If sound qualification cannot be demonstrated at these seams, retain ineligibility and report the failure.

## User Stories

1. As a developer, I want a bounded private table initializer distinguished from externally observable mutation, so that harmless construction is not automatically a module-wide blocker.
2. As a reviewer, I want exact lexical ownership and initialization order, so that a borrowed or shadowed reference cannot inherit a proof.
3. As a developer, I want completed private tables distinguished from mutable ambient state, so that existing-slot primitive lookups can protect actual computed behavior.
4. As a reviewer, I want every primitive operand established without running application code, so that coercion hooks cannot hide effects.
5. As a reviewer, I want writes restricted to existing own writable data slots, so that inherited setters are never accidentally authorized.
6. As a reviewer, I want native method and iterator assumptions excluded, so that fresh allocation is not mistaken for safe `.push` or destructuring.
7. As a developer, I want unsupported aliases, escaped tables and later mutation rejected, so that private-state qualification remains honest.
8. As a developer, I want capture and replay to share current qualification, so that a reviewed case cannot authorize a changed unsafe initializer.
9. As a developer, I want safe source edits to verify, so that digest inequality is not a blanket rejection.
10. As a reviewer, I want actual HTTP/browser observations inspected before explicit review, so that no accepted case is manufactured.
11. As a reviewer, I want independent caught-effect and prototype-hook controls, so that a zero counter is meaningful.
12. As a maintainer, I want imports, policies and callable checks preserved, so that initializer precision does not bypass whole-graph safety.
13. As a maintainer, I want bounded analysis and cache invalidation, so that precision does not create unbounded work or stale admission.
14. As a maintainer, I want Noble's remaining proof obligations reported separately, so that synthetic success is not mistaken for application adoption.
15. As a maintainer, I want existing regression gates and independent review, so that this experiment does not weaken supported behavior or hazards.
16. As a user, I want the production decision returned to #123, so that evaluation does not silently change supported effects.

## Implementation Decisions

- **Evaluation only.** Implementation must await explicit approval of this spec. A subsequent prototype stays on a retained experimental branch outside main; no production PR, release or source-policy change under this evaluation.
- **One shared proof module at the existing analysis seam.** Prefer a small internal known/unknown interface used by public scan, capture qualification, transform and replay preflight. No new public seam, runtime profile, artifact schema or configuration is selected. Do not depend on merging #125's experimental code.
- **Closed initial slice.** One prior top-level const binding directly creates a dense array literal of finite numeric primitives, with no holes, spreads, accessors, nested objects or constructor call. One immediately following synchronous canonical for loop has an exact lexical counter initialized to zero, compares against the fixed literal extent or this array's own length, and increments by one. Both extent and iteration count are at most256; no configurable budget or silent widening. Unsupported or budget-exhausted proof is unknown.
- **Direct existing-slot writes only.** The body may assign numeric expressions to this array at the counter's existing in-bounds index. Primitive expressions use finite numeric literals, exact prior immutable numeric facts, the counter, proven existing-slot reads, parentheses and unary minus or binary addition/subtraction/multiplication/division/remainder. All intermediate values must remain finite. No computed object coercion, nested loops, branches, other counter updates, table-length changes, deletion, property definition or compound/destructuring assignment. The canonical numeric counter increment is the sole supported update expression.
- **No application evaluation.** A bounded AST fact computation may model these primitive operations; it may not eval/transpile/execute the initializer, call a getter, resolve a native method by execution or invoke a dependency to obtain a fact. Exact symbols, declaration order and current physical source are mandatory.
- **Ownership is temporal and transitive.** During construction the table has no alias, export, callback capture, accessor exposure, unknown call use or publication. Its elements are primitive, not borrowed inner objects. The entire module's references must prove no mutation or escape after construction. Imported tables, cyclic publication, top-level await and unknown alias/reference uses cannot establish this proof.
- **Finalization is separate.** Existing lookup-table qualification may recognize this proved-completed private table for direct existing numeric-index primitive reads after initialization. Each later read index must be statically proved a finite in-bounds integer at that exact site; a parameter, unknown index or object-valued key is not a supported lookup. It may not make arbitrary module state safe, export the container, return it from a callable, admit method/property traversal, authorize out-of-bounds reads or suppress later writes. No runtime freeze, source rewriting or generated replacement table is permitted. The target's original table-dependent completion must remain observable.
- **Native-call and iterator obligations remain unknown.** Append into an empty array, `.push`, dynamic method lookup, array destructuring/spread/for-of, ambient BigInt/Number/typed-array constructor calls and imported helper calls receive no new permission from this proof. Existing classifications remain unless the narrowly specified proof genuinely applies; passing a native identity test once is not static evidence. Actual Noble remains a required unsupported comparison, not a positive target for this first slice.
- **Structural and graph checks remain independent.** Suppress only execution findings explained by this exact construction and qualify only its finalized private reads. Preserve all other findings, guard work, policies, unsupported callable shapes, hoisted bindings, transitive and side-effect imports, unresolved/cyclic graph checks and external mutation.
- **Current qualification.** Revision-bound internal cache identity plus existing source, overlays, dependencies, configuration, lockfile, aliases, conditions, realm and physical-locator invalidation must requalify current code before import. Do not change the public graph digest or artifacts solely to tag this experiment. Replay uses the same proof, not stronger permissions than live capture.
- **Keep current refusals.** Ordinary unsafe initialization retains EFFECTFUL_INITIALIZATION and stale unsafe reviewed cases retain REPLAY_SAFETY_REGRESSION. Unsupported finalized reads retain AMBIENT_STATE or their ordinary reason. No new diagnostic taxonomy is required merely to conduct the experiment.

## Testing Decisions

Use the already approved public seams from #125: development scan JSON, natural Node HTTP requests and Chromium button clicks, inspected pending observations, explicit synthetic review and offline verification. A seam change needs discussion; internal AST tests or fabricated artifacts are not substitutes. Prior art includes the pure/hazard yield corpus, cached/uncached graph comparison, source overlays and real browser replay. Each new supported shape is a red/green vertical slice paired with an opposite hazard in both realms.

The positive fixture constructs a dense three-slot numeric table by the stated canonical loop; its callable reads the completed final slot and returns the independently specified scalar4. A second fixture changes a primitive construction expression so the original-source computed completion differs predictably. The application invokes these callables in ordinary workflows. Expected results are fixture literals, never generated by calling the target to manufacture recordings. A completion mutation must be detected; removing or neutralizing table construction must not silently pass. If finalized lookup qualification is unavailable, report that missing seam rather than substituting an unrelated literal-return target for end-to-end success.

| ID | Required scenario in both realms | Public acceptance result |
| --- | --- | --- |
| P1 | Dense fresh table, bounded direct existing-slot numeric writes, table-dependent callable | Baseline rejects; prototype scan admits; natural observed completion4 is inspected/reviewed and verifies offline |
| P2 | Fixed own length versus literal bound, parentheses/prior numeric const, existing-slot read on RHS | Exact supported semantics and independent literal completion; each shape paired with a violating variant |
| P3 | Completed private table used only for supported primitive reads | Initialization and AMBIENT_STATE barriers resolved only by complete construction/finalization proof |
| H1 | Borrowed/imported table, alias reassignment, same-name shadow or later declaration | No borrowed proof; ordinary rejection |
| H2 | Sparse array, new/out-of-range index, length change, delete or accessor/prototype/descriptor change | No existing-slot proof; rejection before application import |
| H3 | Unknown/object-valued operands or later read indices, getter, proxy, conversion hook or nested borrowed element | No primitive/transitive ownership proof; rejection |
| H4 | `.push`, replaced method, inherited numeric setter, iterator/destructuring/spread | Remain unsupported by this proof, regardless of apparent local allocation |
| H5 | BigInt/Number/typed-array constructor or imported helper in initialization | No new native/interprocedural assumption; whole graph keeps applicable ordinary blockers |
| H6 | Escape/callback/return/export of container, later mutation, unknown uses or cyclic publication | Cannot finalize private stable table; applicable rejection remains |
| H7 | Noncanonical/unbounded/nested loop, changed bound or counter, await/try/branch/unknown control flow, extent above256 | Unknown, finite proof budget, no blanket loop permission |
| H8 | Logging, filesystem/network, scheduling/listener, DOM/global/prototype mutation in or beside loop | Each effect exercised independently and rejected; catch cannot confer safety |
| H9 | Safe construction plus unsafe transitive/side-effect import, invalid policy or unsupported callable | Structural/import/policy/callable checks remain |
| H10 | Reviewed source changes to reach an unsafe index, escape, call or effect | Verify reports REPLAY_SAFETY_REGRESSION before import or invocation |
| H11 | Source/HMR overlay/dependency/config/lockfile/alias/condition/realm/physical-locator drift | Cached and uncached current qualification agree; overlays do not replace disk proof; unsafe new graph rejects |
| C1 | Safe equivalent source edit and table-dependent completion mutation | Equivalent edit verifies; changed computed behavior fails completion comparison, not a blanket digest check |
| C2 | External prototype/method/iterator/coercion and caught-effect oracle controls | In a throwaway harness each relevant sentinel independently latches/fails when exercised before trusting absence |
| C3 | All existing pure/hazard tests, packed consumer, dogfood, conformance and bounds/performance controls | No weakened fixtures/floors/manifest; full gates pass or explicit failures reported |
| E1 | Unmodified pinned Noble and eleven named Epic targets | Report exact current blockers and any independently established gain; no forced admission or promised unlock |

Admission-negative application modules must not be imported merely to assert zero counters. Install external effect sentinels before target import for positive capture/replay and stale-case checks; latch failure outside application catch. For the existing-slot positive, a marker-scoped inherited numeric setter must not fire; demonstrate its reachability separately on a throwaway missing-slot write. Oracle controls are isolated from infrastructure, restored on all exits and tested in both realms. Array-method, iterator and coercion controls likewise run only in throwaway harnesses; they grant no production permission. If infrastructure safely prevents installing a required oracle before target import, report the host limitation, not fabricated safety evidence.

### Sequence and exit gates

1. Review the primary-source audit, explicit exclusions and public baseline. Obtain explicit approval of this evaluation spec before prototype implementation.
2. Retain a Node22.19.0/npm11.5.2 project-local npm ci baseline and experimental source pin. First prove P1 and its borrowed/out-of-range opposites, then P2/P3; establish construction correctness and finalization separately.
3. Complete every matrix row in both realms, including external-oracle positive controls, post-review safe/unsafe edits, table-dependent mutation and cached/uncached drift. Report supported, unsupported and failed cases separately; budget exhaustion and missing seams are findings.
4. Register every new acceptance file in the locked manifest and browser tests in the serial pass. Run build/typecheck, full verify including packed consumer, reviewed dogfood, extended core and idiom conformance, and diff checks. Measure analysis work against the declared bound and existing responsiveness contract; never weaken thresholds to pass.
5. Obtain independent Standards and Spec/adversarial reviews. Keep commands, source pin, actual results and limits on the retained prototype branch and in the tracker; no production PR or merge.
6. Read-only re-scan the unchanged pinned application without dotenv values, config-hook execution or blocked-target imports; explicitly label any default-condition/dotenv-metadata-excluded comparison as narrower than full configured qualification. Report every exact remaining target origin, and separate local Noble proof gaps from Prism/Sentry/OAuth effects. No dependency edits or secret discovery.
7. Return evidence to #123 for an explicit production decision. Do not close #106, start #107, manufacture human timing or change the initial60000ms per-case ceiling and mandatory checkpoints after #107/#108.

## Out of Scope

Production delivery, runtime sandboxing, mutable native-global assumptions, intrinsic snapshots, package/file allowlists, environment/config/secret facts, native-I/O fallback, dependency/application edits, source or table replacement, new schemas/profiles, V1 changes, general loops, BigInt arithmetic/conversion proof, imported-call summaries, array appending/iteration, arbitrary objects, mutable-state capture and completion of the eleven-target application proof. Additional capability design requires a separate spec and explicit decision.

## Further Notes

Baseline analyzer a0aa766 (analysis/options source identical to merged0867957) publicly reports zero targets in both realms for the dense three-slot table fixture. It reports EFFECTFUL_INITIALIZATION at the loop counter increment and AMBIENT_STATE at the later table read. The borrowed-global-table opposite remains EFFECTFUL_INITIALIZATION. These are actual scan results; no fixture module was imported or invoked.

The [primary-source research](owned-initialization-research.md) audits pinned Epic8473afd and the normative ECMAScript algorithms. A fresh receiver does not eliminate inherited setters when a write creates a missing slot; array methods and destructuring also involve mutable lookups/iterators. See [OrdinarySetWithOwnDescriptor](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarysetwithowndescriptor) and [Array.prototype.push](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.push). This is why the selected first slice uses existing own data slots and no calls or iterators. Actual Noble contains separate unsupported operations; no application gain is asserted by this spec.
