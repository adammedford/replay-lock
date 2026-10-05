# #127: private live analysis input slice

This retained experiment implements one prerequisite of the
[fixed recipe sequence](constrained-import-recipe-next-step.md), not executable
byte qualification or full G1B. Baseline `d51956f2ad821c8562c79938ecda97084a7afbe1`.

## Mechanism and trust boundary

The new acceptance file installs a private Node synchronous loader hook **before**
dynamically importing the ordinary fixture workflow. Exact built-source pins cover
the analysis client, worker, analyzer, input tracker and transform. A private Worker
bridge redirects only that client's import and preserves the actual analysis
worker URL, supplied flags, realm, message handling and lifecycle. Only registered
synthetic fixture roots receive a private snapshot field and startup preload;
unregistered workers delegate unchanged. Late installation refuses at setup.

The worker hook redirects only the three pinned analysis filesystem imports to a
read-only projection and inserts a sticky-refusal check before successful result
publication. Unknown access cannot become a successful result merely because the
analyzer caught its error. No builtin/global methods, dependency files, application
code or production source files are patched. Hooks rewrite those selected loaded
representations in this private test process; they are not a security sandbox.

The finite fixture contains six captured files and one excluded `node_modules`
directory. Each captured file is bounded at 64KiB through descriptor reads with
before/after/named identity and physical-path checks. Snapshot-only directory
listings imply absences for uncaptured direct children; deeper/outside access is
unknown and terminal. Stats describe the retained logical input view, not fresh
physical currentness. Worker copies have no ambient analysis read fallback.
The existing one-file overlay remains an explicit transform input: this slice
closes ambient reads but does not yet qualify arbitrary overlay/transform output.

The owned-generation gate separately checks retained file identities/text, physical
root and excluded-directory identities and visible root membership before the next
turn and at finishing. Only the exact generated `.replaylock` infrastructure entry
is omitted from membership comparison. Adding another source/metadata path closes
the generation. This is conservative fixture ownership, not arbitrary filesystem
snapshot coherence or immediate revocation of unmanaged writes. Capture/checks are
still successive physical observations, not an atomic whole-filesystem operation.

## Refutable public evidence

The browser regression holds a real `/entry.mjs` request after admission, changes
the physical helper from scalar 3 to 4, then continues the natural button request.
It independently obtains provenance from a fresh ordinary unchanged recording.
With the snapshot mechanism deliberately disabled, the corrected regression fails
because drifted-turn provenance differs from that ordinary recording. Enabled,
the natural result remains 7, the inspected complete candidate retains the original
provenance and empty trace, and the next Node HTTP request gets `GENERATION_CLOSED`.
That drifted observation is never reviewed or accepted.

An initial test attempt incorrectly inspected pending candidates before stopping;
its missing-directory failure was discarded as an invalid oracle. The retained
regression stops recording before inspecting pending artifacts and was rerun red
with the mechanism bypassed, then green enabled. Provenance equality is a regression
observation, **not** proof that the instrumentation algorithm or final executable
representation is qualified.

The second test naturally records Node result 7, inspects the complete candidate,
explicitly reviews it and uses the ordinary offline verifier without snapshot hooks.
It then adds an unrelated source and requires generation closure. All tests remain
at the approved natural HTTP/button, scan/observation/review/ordinary-verify seams.
The file is registered in the locked manifest and serial-browser set; 60000ms
per-test ceilings are unchanged.

## Remaining work

Replay snapshot injection is intentionally not implemented here: an old snapshot
must not mask current-source safety preflight. Ordinary replay of the unchanged
reviewed positive is a compatibility result, not a sealed replay-input result.
Independent recipe construction, exact final code/maps/delivery binding, trusted
transitive inventory, cache/native/extra-entry coverage, broader whole-closure
semantics, coherent acquisition, lifecycle and provenance matrix remain unfinished.
Unknown-access latch behavior is source-reviewed in this slice, not a separate
public negative runtime probe. No new eligible application callables are claimed.

#106 remains open and #107 blocked. No public API, schema, profile, effect-policy
change, pinned application edits/execution, production PR or merge is selected.

## Verification and independent review

Implementation `df4120018ef3d3e9328e4025666fbc46210b0e95` passed the unchanged
`npm run verify` on Node22.19.0/npm11.5.2, including runner/coverage tooling,
package contract, packed consumer and the full locked acceptance suite with serial
browser files. Final `npm run typecheck` exited 0 (it does not typecheck the private
JavaScript scripts). Post-full focused file passed 2/2: browser test 11178ms and
Node test 6275ms, both below the unchanged 60000ms per-test ceiling.
`git diff --check` passed. No hosted CI pass is claimed.

Separate independent four-pass Standards and Spec reviews of `d51956f...df41200`
found zero actionable findings in this scoped slice. The driver reread their
critical source evidence, including TypeScript6.0.3's `usesWildcardTypes` and
`getAutomaticTypeDirectiveNames`: with the fixed compiler options, automatic type
discovery does not activate inherited directory probes. This installed-source
check is not a complete transitive implementation pin or future-version guarantee.
The seven local slice/review gates are manually assessed evidence, not machine
certification of runtime safety. The incomplete pinned application was untouched;
main remained clean at `0867957626ba7a0869fe1fa2753ec311afee60d0`.
