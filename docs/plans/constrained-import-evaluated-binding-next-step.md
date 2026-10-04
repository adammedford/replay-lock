# #127: next evaluated-byte binding gate

Amendment: the user approved this runtime evaluation. The first attachment-only
slice and its remaining limits are recorded in
[ordinary verifier attachment controls](constrained-import-evaluated-attachment-results.md).
The source-audit status and evidence below describe the earlier revision; they
are not a claim that the full recipe or both-host byte binding is implemented.

Status: source audit and proposed next tracer bullet, not implementation or runtime
feasibility evidence. Baseline `dcce94f88ea9f669cd7269a5f5bb4addca09c939`.
The accepted operation-boundary contract and all effect/provenance rules remain.
The incomplete pinned application is untouched and not needed for this audit.

## Why another plugin check is insufficient

The current owner returns retained authored strings from its `load` hook; it does
not control final executable representations. See
[current owner](https://github.com/adammedford/replay-lock/blob/dcce94f/scripts/prototype-import-generation.mjs#L95-L105).

Installed Vite8.2.2 `dist/node/chunks/node.js:20577–20608` returns cached transform
results before loading. At20671–20715, plugin transforms run, then the optional
module-runner SSR transform runs **after** them. A last plugin transform is
therefore not a final evaluator boundary. `fetchModule` at34296–34361 also handles
externalization, `{cache:true}`, inline source maps and hashbang replacement after
the transform request. Native browser module delivery at25189–25211 sends the
client transform result; that is a different representation from SSR output.

Installed `dist/node/module-runner.js:1017–1024` evaluates an `AsyncFunction` with
the returned code, or uses native `import` for externals. At1170–1173, evaluated
module promises can be reused without evaluator re-entry. At1205–1225, data and
builtin paths can bypass the transport and cache replies reuse earlier metadata.
These are verified installed-source observations, not evidence that a prototype
already controls those routes.

The ordinary live `ssrLoadModule` path creates its own retained compatibility
runner with the default evaluator (`chunks/node.js:11837–11867`). The earlier
[standalone placement probe](https://github.com/adammedford/replay-lock/blob/dcce94f/scripts/prototype-import-placement.mjs)
owns a separate runner/transport and seals transformed fixture maps. It does not
prove attachment to the real recorder or ordinary isolated Vitest worker.
The [replay source audit](constrained-import-replay-binding-research.md) examines
that other half; neither path may substitute for the missing one.

## Proposed finite proof representation

Keep qualification and original host semantics separate. A private generation
would retain authored closure and metadata, the exact fixed trusted transform
inventory/version, resolved identities and realm-specific executable strings.
Count authored and each executable representation independently against the
existing caps. No arbitrary plugin or application configuration runs to obtain a
proof. Preparing a reference from the same untrusted output later compared to
itself would be tautological; a digest proves equality, not transform safety.

For each application module, release/evaluation must use the exact prepared string
and identity, not a second transform/reread. Refuse mismatched output, external
delegation, unknown extra modules and unbound cache replies. Trusted recording and
verifier infrastructure must remain a finite explicit prerequisite, not become an
application/package exception. No executable namespace escapes the owned workflow.
These are proposed requirements; snapshot coherence, transform trust and complete
dependency identity still need independent proof.

## Sequenced next tracer bullet

1. Establish actual attachment points in **both** the live owner and the ordinary
   isolated Node/Browser Mode verifier. First prove that each can withhold a final
   application representation before initialization. If ordinary replay cannot
   expose a controllable point, retain that failure and stop expansion; do not
   replace the verifier with a standalone passing runner.
2. Retain the ordinary public result7 positive: natural HTTP/button call, actual
   complete candidate inspection, explicit review and normal offline verify.
3. Add a harmless late-output mutation control at the fixed trusted fixture-host
   boundary, leaving authored input unchanged. Require explicit refusal, not
   successful result8 or an ordinary output mismatch after unchecked evaluation.
   Establish an independent mutation-positive control before trusting the refusal.
   This control is a proposal, not an executed H7 native-effect oracle.
4. Reuse the accepted warm-turn contract: unchanged turns preserve identity;
   source/resolver/transform identity drift closes before another turn; a fresh
   page on the old server cannot grant new authority. Include cold and warm
   transport/evaluator cache paths rather than only first imports.
5. Independently qualify native-effect oracles and unsupported external/builtin/
   data/extra-entry routes before claiming G1B. Artifact currentness stays a
   separate gate; no changed-turn observation is accepted merely because it ran
   sealed old bytes. Any additional public seam or persisted fact needs approval.
6. Only after both-host attachment and refutation succeed, complete the remaining
   matrix, caps, dogfood/conformance/responsiveness and independent review.

All proposed tests stay at the approved scan, HTTP/button, observation inspection,
review and ordinary verify seams. The fixed fixture-host mutation is internal
test infrastructure, not an application effect or generic plugin capability.
No new test, adapter, runtime export, schema or profile is introduced by this note.
Full G1B remains unmet; #106 open and #107 blocked. Prior verification is historical
and is not represented as a new run for this documentation-only audit.

## Next approval checkpoint

Recommend evaluating a **fixed, pinned trusted transform recipe** plus private
attachment to the ordinary verifier's transport/evaluator and browser delivery.
This is a candidate to refute, not an accepted output grammar or a safety proof.
Its value is testing actual both-host ownership without granting arbitrary
transformed output authority. Select that bounded runtime evaluation explicitly
before adding a worker bridge or choosing the transform-proof contract. No public
loader API or persisted proof/schema change is proposed.

## Independent review and verification

Four-pass Standards review of `dcce94f...c2f9c5c` found no documented-standard
violations or actionable heuristic findings. Four-pass Spec review found zero
actionable mismatches for the documentation-only audit. Both checked installed
execution routes and declined to certify runtime feasibility. The driver reread
the critical Vite/Vitest excerpts and package pins; `git diff --check` passed.
No new tests, builds, imports, typecheck or full verification runs occurred.
Main remains clean at `0867957626ba7a0869fe1fa2753ec311afee60d0`; no application
reconstruction, execution or edits were performed. Its prior revalidation
limitation remains unresolved.
