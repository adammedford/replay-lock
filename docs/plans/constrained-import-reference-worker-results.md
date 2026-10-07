# #127: independent Node instrumentation preparation

Retained private implementation: `41b04cc`, startup repair `7e59856`, based on
`861416c`. Continuation branch: `prototype/reference-preparation-127`.
The old temporary checkout lost its Git pointer and tracked files; remaining
files were preserved. A fresh checkout was created from the retained commit,
outside main, without restoring the incomplete pinned application.

## What this slice answers

A distinct worker can prepare the fixed qualified entry/helper closure from
the six-file analysis snapshot before natural Node invocation, without evaluating
application code or receiving actual host outputs, graph, cache or namespace.
It uses the trusted pinned instrumentation algorithm with a fresh project for
each source, original physical ids and explicitly declared Node realm/options,
generation `0000000001` and runtime import. It is not an independently implemented
compiler oracle. The parent freezes the returned table and terminates the worker
before attaching its table to ordinary Node analysis workers.

Actual worker publication checks the retained authored text, request tuple,
instrumentation code/map and analysis result. A mismatch latches refusal in that
worker. An authored-target-free module's null instrumentation return is checked
against the independently prepared zero-target record, not certified as an
executable output. Preparation precedes HTTP listen; selected application paths
remain refused until recording start succeeds.

The downstream helper control remains deliberately **unprevented**. References
exist for the whole authored closure, but actual publication checks happen as
ordinary worker requests occur. There is no whole-actual-closure pre-evaluation
release barrier and no final executable comparison. This distinction is essential.

## Observations through approved seams

The existing locked acceptance file now has a natural Node HTTP experiment:

| Control | HTTP / natural completion | Pending candidates | Review |
| --- | --- | --- | --- |
| Actual instrumentation changed, comparison bypassed | 200 / 8 | One complete Node candidate | Never accepted |
| Same actual instrumentation change, comparison enabled | 409 / GRAPH_REFUSED | Zero | None |
| Unchanged instrumentation | 200 / 7 | One complete Node candidate | Explicit CLI review, ordinary offline verify |
| Helper changed at the later ordinary live evaluator | 200 / 8 | One complete Node candidate | Never accepted; exposed downstream gap |

No target is invoked to synthesize expected artifacts. Actual candidates are
inspected for realm, completeness, locator, arguments, completion and trace before
only the unchanged synthetic result is reviewed. The verifier is ordinary replay;
this slice does not construct independent replay references.

Initial red: before implementation the bypass control returned 7 instead of 8.
An additional guard-sensitivity run disabled only comparison for the guarded
mutation: the test failed at HTTP 200 versus required 409. Comparison was restored.
An initial tuple check incorrectly depended on object insertion order; comparison
now uses structured equality of serialized representations, including null maps.

## Verification and review

Node **22.19.0**, npm **11.5.2**, writable isolated npm cache:

- Full unchanged `npm run verify` exited 0: coverage/runner regressions, package
  contract, packed consumer and complete locked acceptance suite with its serial
  browser pass. No manifest entries were removed or commands weakened.
- Affected acceptance file passed 5/5 during focused iteration. After full verify,
  the new four-control experiment passed again at `7e59856` in 23252ms, below its
  unchanged 60000ms ceiling. This is local evidence, not hosted CI.
- Typecheck passed before and after full verify; private JavaScript is not covered
  by TypeScript. Syntax checks of all seven changed script/test files and
  `git diff --check` passed.
- Selected rebuilt analysis/cache/transform hashes match the existing private
  loaded-source pins. Additional options source SHA-256:
  `ec26840491d70107a18ecc97bfef392830b0de3d8a762c4317a55de902938203`.
  This options check reads the dependency source before import; it is not an
  atomic loaded-module/transitive-inventory guarantee.

### Standards

Independent four-pass review of `861416c...7e59856`: zero actionable findings.
The driver reread the source evidence and startup repair.

### Spec

Independent four-pass review of `861416c...7e59856`: zero actionable findings for
the deliberately partial instrumentation contract, not full #127.

Summary: Standards 0, Spec 0; neither axis reports a worst remaining finding.
Reviews were source-only, not independent runtime proof. Completion ledgers are
manual assessments backed by command observations, not machine-certified safety.
Primary main remains clean and unchanged at `0867957`; retained delivery stays
outside main, with no production PR or merge.

## Remaining obligations

This does **not** establish full G1B or final executable binding. Ordered plugin
stages, map composition/finishing, module-runner lowering, Vite/Vitest decoration,
browser URLs/wire bytes/304 reuse, a whole actual closure barrier, retained release
objects, independent replay/browser references and native/cache/extra-entry routes
remain unfinished. Unknown-access, swallowed-refusal, later-generation and lifecycle
coverage is not added by this experiment. The fixed first generation is intentional;
restart support is not claimed.

Selected source pins are not a complete transitive tool inventory; acquisition
currentness checks are not atomic capture. No new eligibility, artifact/schema/profile,
public API or effect-policy exception, dependency file edit, production PR/merge,
pinned application restoration or execution follows. #106 stays open and #107
blocked. The earlier C2 diagnostic-order handoff remains unresolved.

Next: independently prepare the fixed Node downstream recipe (plugins/maps,
lowering and delivery decoration), then add whole-closure pre-evaluation withholding
and repeat the same late helper mutation until it refuses with no candidate. Do
not move the mutation upstream or relabel instrumentation equality as that result.
