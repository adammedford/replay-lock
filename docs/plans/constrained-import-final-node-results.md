# #127: independent final Node fixture comparison

Retained diagnostic continuation of the [native compatibility slice](constrained-import-native-runtime-results.md),
based on `8b440e6`. This prepares a two-file final reference and exercises two
comparison boundaries. It does **not** complete all-or-nothing import prevention.

## Independent preparation

The separate worker receives sealed authored/analysis inputs and a boolean selecting
this finite recipe, never actual outputs, graph, cache, namespace or mutation mode.
It prepares instrumentation as before, then handles only the two fixed `.mjs` ids:

1. Reject dynamic imports, re-export edges, import attributes, import-meta forms,
   hashbangs, inline maps and every undeclared import. Entry must have exactly its
   inserted observer import and authored helper import; helper has no imports.
2. Rewrite `./helper.mjs` to `/helper.mjs`. Keep `replaylock/dev/runtime` bare:
   [the dev plugin](../../src/dev-server.ts) explicitly declares
   `ssr.external:['replaylock']`. This was confirmed from source after the initial
   declaration incorrectly assumed empty external configuration. No host output
   was used to infer expected code.
3. Preserve the instrumentation map across the serve rewrite, which contributes
   `map:null`. Require complete authored sourcesContent and the single known
   physical source; relativize that source as Vite does. Helper's actual authored
   shortcut emits no instrumentation map, not the worker's hypothetical wrapper.
4. Use the pinned exported `moduleRunnerTransform` with **authored** originalCode,
   exact URL and independently prepared plugin input. Validate finite deps/no
   dynamic deps. Compose and serialize maps in the same recipe, without copying
   actual map output or normalizing unexplained differences away.
5. Independently acquire evaluator declaration padding from the pinned evaluator's
   empty-function calculation, then decorate code with that offset, physical
   sourceURL, Vite marker and base64 JSON map. No application is evaluated.

Per-record executable size is independently capped at 64 KiB and the total actual
declared application representation at 256 KiB. Parent recursively freezes the
worker table. Final expected records are not passed to the actual instrumentation
worker: its bridge strips them, retaining only the earlier instrumentation contract.

## Actual boundaries

The private `finalNode` option requires sealed analysis, prepared instrumentation
release, the Darwin ARM64 native acquisition and the matching live control mode.
Resolved server consumer, keepProcessEnv, module-runner transform, absence of define,
external/noExternal configuration, symlink handling, no discovery and no speculative
pretransform must match the fixed declaration. Existing version/file compatibility
checks remain; no native stage is disabled or reordered.

Within the first owned ordinary HTTP invocation, before `ssrLoadModule`, fetch both
actual application representations without runner import. Compare code/file/id/url
exactly with independent records; cold invalidation flags must be true. Entry
evaluation is withheld until both comparisons pass. At the real evaluator boundary,
run the original harmless late control first, then compare the resulting code and
metadata again before delegating to the original evaluator. Post-preparation flags
must be false; evaluator padding must match. Unknown inline records refuse. The
only native external entry permitted by this private adapter is the declared
observer runtime file URL, not an arbitrary native application route.

Refusal is sticky. A second invocation refuses before a cached namespace can skip
the evaluator. Only `/invoke` and the three ordinary recording control endpoints
are served under this option; client, filesystem, encoded and HTML routes refuse.
This is conservative lost admission, not warm-cache or browser coverage.

## Controls and precise limits

| Private control | Ordinary HTTP result / pending observation |
| --- | --- |
| Unchanged release | 7; one complete inspected observation, explicit review, ordinary offline verify |
| Same original late helper mutation, final comparator disabled | 8; one complete unreviewed observation |
| Same original late helper mutation, final comparator enabled | typed `EVALUATED_INPUT_REFUSED`; zero pending candidates |
| Fetched preparation representation changed | typed `EVALUATED_INPUT_REFUSED`; zero pending candidates |

The preparation control changes the fetched representation being checked, **not**
Vite's underlying cache or a subsequently delivered module. It exercises the
preparation comparison, not a mutated-cache delivery experiment.

**The late helper comparison may occur after entry evaluation has already begun.**
Its zero-candidate result proves neither zero entry execution nor whole-graph
all-or-nothing late prevention. Checking both cold preparations before entry does
not close this later gap. This is a newly exercised final-output refusal boundary,
not completion of the promised whole-graph guard. The next design must own the
complete final release family across all remaining adapters, or establish an
equivalent barrier; lazy per-module equality cannot retroactively undo entry work.
The existing late mutation was not moved upstream to make this result pass.

Native loaded-byte/transitive provenance, JS/parser/map implementation closure,
runtime native-import transitive identity, load-time race exclusion and exhaustive
host stage/function identity remain unproved. Current file pins and structural
declarations are compatibility checks, not that stronger qualification. Ordinary
offline verify for the release case does not test this private guard in replay;
replay and browser final recipes remain separate work. No initializer/native-effect
oracle, arbitrary application gain, complete G1B or C2 diagnostic-order repair is
claimed. No production/API/schema/profile/dependency/app change is selected.

## Evidence

The tightened four-mode targeted HTTP experiment passed in 23,366 ms, below the
unchanged 60,000 ms ceiling. The subsequent standalone affected-file run measured
the same experiment at 23,184 ms.
Disabling only the final comparison caused its guarded late case to fail with
`200 !== 409` (exit one). Independently disabling only the withheld preparation
comparison caused its preparation case to fail with the same status mismatch.
Both temporary controls were restored immediately; no mutated candidate was
reviewed. Test cleanup closes every host.

A read-only independent review found no actionable correctness/Standards findings
and specifically required the entry-already-started and preparation-copy limits
above. Full verification and restored acceptance evidence are recorded in
[the bounded slice ledger](constrained-import-final-node-gates.md). Scope remains
non-production; #106 stays open and #107 blocked.

On Node 22.19.0/npm 11.5.2, unchanged `npm run verify` exited zero, including
tooling, package contract, packed consumer and locked/serial-browser acceptance.
The subsequent standalone affected file passed 7/7 with no skips or failures
(80,381 ms aggregate; every individual test retained its 60,000 ms ceiling).
Typecheck passed but excludes the private JavaScript; nine changed JavaScript
syntax checks and diff check passed. Four scoped manual evidence gates are met,
zero unmet or abandoned. This does not change the broader unmet feasibility gates.
