# #127: close the recipe inputs before byte comparison

Source-audit baseline: `ee6d44053acd01223da9075fd88e473a143e5c27`.
This advances the fixed pinned recipe evaluation, not its runtime implementation.
The [live attachment controls](constrained-import-live-attachment-results.md)
and [ordinary replay controls](constrained-import-evaluated-attachment-results.md)
proved controllable application boundaries in their narrow slices. Neither
produces an independently qualified executable reference. Full G1B remains unmet.

## Newly identified prerequisite

The retained generation seals the static entry closure and four fixture metadata
files, then supplies their strings from `load`; it does not seal a compiler plan.
See [generation acquisition and delivery](https://github.com/adammedford/replay-lock/blob/ee6d440/scripts/prototype-import-generation.mjs#L65-L105).

The real live transform calls a realm-specific worker with `code`, recording
generation, resolved options and a runtime import. The worker constructs its own
disk-backed project cache. See [live transform](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-server.ts#L344-L364),
[worker request](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-analysis-client.ts#L22-L55)
and [worker plan](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-analysis-worker.ts#L14-L24).

That cache rebuilds when options or tracked filesystem inputs change; a supplied
module overlay replaces **one** source, not every dependency or metadata input.
The authored-target rejection shortcut can also reread disk. See
[cache transform](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-transform.ts#L19-L52).
Analysis walks non-hidden project directories, reads source and metadata, then
resolves aliases, conditions, package imports and dependencies. Files outside the
requested entry closure can affect the plan and its digest. See
[analysis inputs](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-analysis.ts#L123-L193)
and [digest construction](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-analysis.ts#L1160-L1170).
The input tracker caches text and compares file/directory stats later; it is not
an atomic closed-input capture. See
[input tracker](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-project-cache.ts#L10-L56).

**Consequence:** applying the same instrumentation function twice to a retained
entry string is not yet a qualified independent recipe. Both runs may consume
unbound ambient analysis inputs. Matching hashes would hide that missing premise.
This is a source-backed design constraint, not a newly executed drift failure.

## Reference contract to evaluate

Keep these distinct, private and explicit; do not change public graph digests or
persist a new proof in V2 artifacts.

| Input layer | Required ownership before application release |
| --- | --- |
| Authored application | Entire qualified static closure, physical identities, exact strings and resolution edges |
| Analysis | All source/metadata/directory/absence inputs actually used by the plan, plus resolved options and realm; no fallback to mutable disk |
| Recipe | Fixed ordered host transforms, transitive implementation identities, configuration and adapter revision; unknown stages refuse |
| Observer infrastructure | Explicit finite runtime/harness identity and generated parameters; never a package-wide application exception |
| Host output | Per-realm final executable representation and identity, maps/URLs and external/cache status; exact independent size accounting |

Live wrappers embed the source digest, generation and environment and select a
runtime import. Replay additionally emits replay exports. Thus one literal string
cannot serve as both recipes. See
[wrapper metadata](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-transform.ts#L126-L133)
and [runtime/replay exports](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-transform.ts#L175-L196).
Browser live infrastructure also generates session-dependent startup code and
HTML injection; those parameters must be private recipe inputs, not leaked in
evidence or trusted as arbitrary application output. See
[runtime generation](https://github.com/adammedford/replay-lock/blob/ee6d440/src/dev-server.ts#L330-L339).
The [parallel replay audit](constrained-import-recipe-research.md) identifies
additional verifier-specific map, harness and resolution inputs.

The existing Vite/evaluator file pins are attachment compatibility checks, not
this transitive inventory. A reference host may prepare transforms without
evaluating application modules, but its independence must come from sealed inputs
and a fixed trusted recipe, not a different server name. Copying output from the
actual live/replay hook into its expected-value map is expressly insufficient.
Moving to a shadow filesystem likewise requires proof that changed physical ids,
resolver behavior and source maps do not change the compared representation;
stripping or normalizing unexplained differences is not an exact-byte proof.

## Sequenced implementation gates

1. **Close analysis inputs first.** Evaluate a private fixture-only mechanism for
   feeding the same sealed analysis inventory into actual instrumentation and
   independent reference preparation. Current APIs do not accept that inventory;
   a one-file overlay is not a substitute. Keep arbitrary config/plugin execution
   excluded. Refuse unknown input access rather than widening the trusted set.
   If a private mechanism cannot preserve the ordinary hosts without an additional
   public seam, stop and seek approval for that seam before tests or implementation.
2. **Prepare before release, without application evaluation.** Enumerate all
   application closure identities and each live/replay realm's exact reference
   output. Bind generation/runtime/harness parameters and final map decoration.
   Count original and executable sizes independently against #127's existing caps.
   Qualification failure must withhold the entry, not wait until an unsafe
   dependency's evaluator is reached. Treat unknown native/cache/extra-entry routes
   as unresolved coverage, not permission.
3. **Make late drift refutable at the approved public seams.** Retain the independent
   mutation-positive control: unguarded harmless helper change produces 8 rather
   than 7. Under the candidate guard, identical authored input plus that late change
   must instead produce explicit refusal before any application evaluation, with no
   pending candidate. Exercise natural Node HTTP and real Chromium button calls in
   live capture and ordinary offline verify. For replay, first record, inspect and
   explicitly review a genuine release-mode 7; mutated replay must be infrastructure
   refusal, not `OUTPUT_MISMATCH` from already executing changed bytes.
4. **Refute stale authority.** Unchanged warm turns preserve identity. Add analysis
   source/metadata and recipe drift as well as application drift; detected change
   closes before the next owned turn. An admitted immutable turn may finish after
   a mid-call edit only if every actual analysis and executable input is retained.
   Do not claim immediate revocation of unmanaged writes. Probe transport/evaluator
   cache and fresh-page routes separately.
5. **Finish the wider gate, not just equality.** Independently reachable native
   effect oracles, unsupported route coverage, closure semantics, lifecycle,
   coherent acquisition, provenance and boundary/performance workloads remain
   required. Only then run the full unchanged verification/conformance gates and
   independent reviews for a runtime slice. No new eligibility is promised.

The first gate is now specific: **sealed analysis inputs**, not another attachment
control or a comparator over the helper alone. These gates refine the already
approved candidate; they do not select a public API or transform-output grammar.
Per-test 60000ms ceilings and the approved operation-boundary contract are unchanged.
#106 stays open, #107 blocked. No pinned application reconstruction, execution,
dependency exception, production PR/merge, schema change or effect-policy relaxation
is included. This source-only audit does not rerun or renew prior runtime evidence.
