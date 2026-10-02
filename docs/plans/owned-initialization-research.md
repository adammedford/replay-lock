# Owned initialization: primary-source research

Date: 2026-10-02. Status: investigation and proposed evaluation boundary, not implementation or production permission. Decision parent: [#123](https://github.com/adammedford/replay-lock/issues/123). The scalar branch experiment [#125](https://github.com/adammedford/replay-lock/issues/125) is separate and need not be adopted to evaluate this slice.

## Question and conclusion

Can a bounded, module-private numeric initialization loop be proved safe without assuming pristine globals/prototypes or granting dependency exceptions?

A plausible first slice is a closed numeric loop overwriting already-existing writable own indices of a fresh dense array literal. This is a design inference requiring adversarial evaluation, not an eligibility result. It does **not** match pinned Noble SHA3 construction: that source additionally needs array growth, inherited method invocation, iterator/destructuring semantics, ambient conversions, imported helper execution, and typed-array construction. Do not label a dense-array synthetic result as Noble or Epic compatibility.

## Source pins and observations

ReplayLock base: `0867957626ba7a0869fe1fa2753ec311afee60d0`. Source links below use that fixed commit. Epic app source HEAD: `8473afd804b66dba6a23f317908dc35d1535e90d`; inspected dependency package: `@noble/hashes@2.0.1` in the retained `replaylock-epic-stack-wpOuMM/app/node_modules` tree. Package bytes are pinned independently of app Git HEAD:

| Dependency file | SHA-256 |
| --- | --- |
| `sha3.js` | `8741330184fd2af27d8805e400888060294ac1e31e7b7038e5347c31e1bb33ca` |
| `_u64.js` | `e48c0cfc10810439a4807b46db136ce603a3fa09b62584f513ef2f3ca496af54` |
| `utils.js` | `11319ec0a8132a0c2ced8c98af33ae9274c001d6baf4f4709c4a6115e031a3c5` |

The dependency references below are line numbers in those exact installed files, not assertions about another release.

| Site | Actual execution | Distinct unresolved obligation |
| --- | --- | --- |
| `sha3.js:18–23,38` | Calls ambient `BigInt`; intermediate `R`/`t` values subsequently use BigInt operators. | Literal BigInt arithmetic is not the same as proving a mutable ambient function call. First slice excludes both. |
| `sha3.js:24–32,40` | Starts empty arrays, then invokes `.push` during 24 rounds. | Fresh receiver does not prove inherited method identity or safe creation of absent indices. |
| `sha3.js:29` | `[x, y] = [y, numericExpression]`. | Array assignment destructuring consumes an iterator, not two intrinsic indexed reads. |
| `sha3.js:35–38` | Nested seven-step loop and conditional BigInt updates. | Additional control flow/type/resource reasoning, excluded from the smallest slice. |
| `sha3.js:42–44`; `_u64.js:13–21` | Calls imported `split`, allocates two `Uint32Array`s, calls `fromBig`, destructures returned values. | Interprocedural initialization, mutable constructors/conversions, and iterator hooks are separate capabilities. |
| `_u64.js:6–11` | Top-level ambient `BigInt`; helper ambient `Number`. | Imported graph remains subject to existing admission, even if one local loop is proved. |
| `utils.js:79,104,106` | Endianness IIFE allocates typed arrays; feature-detection IIFE invokes `Uint8Array.from`; hex table invokes `Array.from` with a callback. | Whole-graph initialization cannot be cleared by suppressing the first SHA3 diagnostic. Existing catalog allowances are not new ownership proofs. |

Current ReplayLock attributes initialization findings to a binding, module, or all importers; it then propagates dependent taint. A proof must discharge only the exact covered writes, never discard unrelated findings or import edges. See [initialization attribution](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-analysis.ts#L608), [taint propagation](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-analysis.ts#L1110), and [existing initialization catalog](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-catalog.ts#L104). The existing flat-table treatment requires non-mutation/non-leakage; initialization proof alone must not imply arbitrary safe later table use ([lookup-table boundary](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-analysis.ts#L667)).

The parent investigation reproduced this public-CLI baseline in both realms: `const table = [0, 0, 0]; for (let i = 0; i < 3; i++) table[i] = i * 2; export function answer() { return table[2]; }` admits zero targets, reporting `EFFECTFUL_INITIALIZATION` at the increment and `AMBIENT_STATE` at the table read. Thus two independent obligations are necessary: safe construction **and** finalized private stable-read qualification. A positive fixture returning the literal `4` without consuming the constructed table would not demonstrate the latter. The borrowed-global-table opposite remains effectful. These baseline observations were supplied by the parent agent's executable investigation; this research leaf itself did not execute them.

## Normative semantics that constrain the design

Dense array literals define own data properties directly, including when prototypes have been modified. Elisions leave indices absent. Array assignment destructuring obtains an iterator, so even a fresh literal can invoke a replaced `Array.prototype[Symbol.iterator]`. [ECMA-262 ArrayAccumulation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-arrayaccumulation), [DestructuringAssignmentEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-destructuringassignmentevaluation).

Native `push` uses `Set` for each appended index and the length property; identifying native `push` would not itself prove that no inherited setter runs. [ECMA-262 Array.prototype.push](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.push).

When an own descriptor is absent, ordinary assignment delegates to the prototype; an inherited accessor setter can execute. An existing writable own data property instead updates the receiver's own descriptor. Own-data reads likewise avoid inherited accessors. This explains the existing-index boundary, provided no intervening code can alter descriptors or replace the receiver. [ECMA-262 OrdinarySetWithOwnDescriptor](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarysetwithowndescriptor), [OrdinaryGet](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryget).

Arithmetic conversion can invoke object coercion; requiring proven numeric primitives removes that source of hooks, not all other sources of effects. [ECMA-262 ToNumeric](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumeric).

## Proposed smallest closed slice

These are recommended proof obligations for the public evaluation spec, not changes made here:

1. Track exact lexical symbols and statement order. A module-local `const` array is created directly by a dense, non-spread numeric literal; no imported/ambient receiver, hole, proxy, accessor, constructor, or alias is eligible.
2. Restrict to one canonical `for (let i = 0; i < N; i++)` with literal integer `N`, initially proposed maximum 256 iterations. `N` must not exceed the literal's existing index count. No nested loops, alternate increments, loop-variable writes, early exits, exception handlers, or callbacks. A budget breach fails closed, never partially proves the loop.
3. Within the closed region, allow only explicitly enumerated finite-number literals, proven numeric locals, numeric arithmetic, and indexed writes to existing own indices. Preserve exact JavaScript evaluation order. Validate every intermediate/result/index; non-finite, non-integer index, unknown type, missing index, or unsupported operation rejects proof. Parentheses do not expand capabilities.
4. No method calls, function calls, `new`, destructuring, spreads, coercible objects, environment facts, dynamic evaluation, imports used as numeric facts, property-descriptor operations, array length changes, deletion, or prototype writes in the proof region. Never execute source to infer facts.
5. No escape, alias, import-cycle exposure, or arbitrary code execution can occur between allocation and writes. The proof covers a contiguous closed statement region; earlier/later initialization remains separately analyzed. Require module-private scalar-only reads at proven existing indices after completion, no later writes, exported array, whole-object return, callback argument, or leaked alias. Later callable eligibility is still independently checked.
6. Return a bounded proof result with exact covered sites or unknown; retain diagnostic provenance for uncovered sites. Share this decision at scan/transform/capture/current replay-preflight seams. Do not introduce runtime permission, source rewriting, a package whitelist, or artifact schema changes.

The current cache separates realms/options and validates file snapshots; its overlay path constructs a separate project. Evaluation must preserve those properties and bind the proof implementation revision to internal plan identity without rewriting public case schemas. [Session/overlay cache](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-transform.ts#L16), [physical input validation](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-project-cache.ts#L10).

## Evaluation matrix and evidence discipline

Every row is required in both Node and browser realms. These are proposed tests, **not executed results**.

| Control | Expected evidence |
| --- | --- |
| Dense numeric literal plus bounded overwrite loop and private fixed-index scalar getter | Public scan admits the getter; real loopback HTTP request/browser click records it; inspect real pending observations, review explicitly, then offline verify the expected scalar. |
| Same admitted fixture under pre-import replaced `push`, iterator, and numeric-prototype accessor controls | No sentinel runs: admitted syntax does not invoke those hooks. Confirm each sentinel in a separate throwaway positive-control execution before relying on the negative result. |
| Empty/holey array write, append, `.push`, array destructuring, spread, or object numeric operand | Scan fails closed; separate pre-import positive controls establish missing-index accessor, method, iterator, or coercion hooks actually latch. |
| Unknown bound/index, too many iterations, nested/noncanonical loop, early exit, call, constructor, or non-finite arithmetic | No ownership proof; existing diagnostics retained. |
| Alias/export/whole-object escape, imported receiver, descriptor mutation, later mutation, import-cycle exposure | No lookup-table/ownership admission; exact violated obligation identified. |
| Unrelated logging/network/global effect next to an otherwise proved loop; transitive or bare effectful import | Remains blocked; proving local writes never erases separate initialization or dependency findings. |
| Accepted artifact followed by safe numeric edit | Current source independently analyzed; no blanket digest-mismatch prohibition. Verify succeeds only if observed behavior still matches. |
| Accepted artifact followed by escape, missing-index write, method/destructuring change, or effectful dependency | Replay preflight reports safety regression before target import; sentinel remains unexecuted. |
| Source/overlay/config/lockfile/dependency/alias/conditions/physical replacement and realm changes | Warm analysis equals cold current analysis; no stale admitted proof. |
| Pinned Noble/app differential scan | Pin exact bytes and all named locators; report unresolved graph causes and synthetic results separately. Zero named-target gain is an acceptable evaluation outcome. |

Mutable-prototype controls can disturb the test runner itself. Install them immediately before isolated target import, scope sentinels to a receiver or marker where possible, restore descriptors in `finally`, and latch before throwing. Verify the latch outside the application's catch path. Do not patch inspected application/dependency files, manufacture cases, invoke blocked Epic targets, execute application configuration, or discover secrets. Generated throwaway replay harness setup must establish sentinels before dynamic target import and include a reachable positive-control mode that proves the setup actually ran. This is a test oracle, not a production sandbox.

Completion would require the public test matrix, natural record → review → verify evidence, unchanged full verification/typecheck/dogfood/extended-conformance gates, independent standards/spec review, and a retained evaluation branch. No production adoption or claim that any of the eleven Epic targets is unlocked follows from this research.

## Research review

Four passes completed: (1) source inventory and closure boundary; (2) pinned-byte/line fidelity and normative algorithms; (3) adversarial prototype, iteration, escape, replay, and whole-graph counterexamples; (4) scope/claim polish. No application/configuration or target code was executed; no implementation, dependency edits, build, install, or runtime test was performed.
