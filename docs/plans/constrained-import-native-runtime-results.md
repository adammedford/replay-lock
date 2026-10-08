# #127: selected native route and actual exposed hooks

This retained continuation of the [native source audit](constrained-import-native-recipe-research.md)
adds a private compatibility acquisition before the fixed fixture host opens
application admission. It is not a final executable comparison or a complete
native/transitive identity proof. No production behavior is changed.

## Acquisition

`nativeRecipeIdentity: true` is a private harness option, accepted only with owned
turns and live attachment controls. Acquisition happens after trusted Vite server
creation and before listener admission, reference preparation and the existing
evaluator attachment. It does not run application transforms or call a target.

The measured route is deliberately only Darwin ARM64, Rolldown `1.2.5`. The
acquirer checks the installed JS loader/adapter/constructor and ARM64 binary
digests. The newly measured loader SHA-256 is
`20227dd9120aa1f62f39fe02cc9db909c61f41f172830d97a7350b8a23618ea3`;
the other three pins are recorded in the source audit. It compares the pinned loader's
export object by reference with the cache entry at the physically resolved native
filename, refusing absent or multiple matching entries. This distinguishes the
selected cached loader export from an unused installed candidate. Native path
override, forced WASI and WASI flavor selectors refuse even when Vite already
cached the native binding; WebContainer/PnP and other platforms refuse too.

The acquirer examines the **actual SSR environment's** two native plugin objects,
their options, enumerable property sets, hook shapes and membership in Vite's
sorted hook lists. The fixed declaration is independent of these observations:

| Plugin | load | resolveId | transform | watchChange |
| --- | --- | --- | --- | --- |
| `builtin:oxc-runtime` | pre | pre | normal | normal |
| `builtin:vite-json` | normal | normal | normal | normal |

Both expose `getOrder` as well. JSON options must be exactly
`{namedExports:true,stringify:'auto',minify:false}`; Oxc runtime options and both
plugins' enforce override must be absent. The actual sorted transform list must
place ReplayLock dev instrumentation before Oxc runtime, before JS Oxc, before
native JSON, with one occurrence of each. This checks that relative subsequence,
**not** an exhaustive declaration of every host transform or its function origin.
No native plugin is disabled or reordered. No actual output is supplied to the
independent reference worker.

## Important limits

- An on-disk digest measured after a module was loaded is not proof of the exact
  bytes previously loaded into memory. Selected export-object/cache identity and
  current file pins do not prove source-to-binary reproducibility, loaded JS
  closure provenance, load-time race exclusion or native/parser/helper transitive
  inventory. Those remain prerequisites to stronger qualification.
- This check occurs after trusted toolchain initialization. It refuses application
  admission, not execution of an override that a process loaded before entering
  this check. The negative controls intentionally use the already-loaded fixed
  toolchain; they do not load the supplied override or force a new WASI binding.
- The acquired record is not authority for later turns, cache hits or final
  evaluated bytes. Warm cache ownership and lifecycle revalidation remain open.
- Other platforms retain existing experiments without opting into this narrow
  acquisition. The native-specific negative test skips outside Darwin ARM64;
  passing there provides no native identity evidence for that platform.
- The existing late helper control stays downstream and unchanged. It still
  yields 8 and an unreviewed complete observation: the final-output guard and
  whole-closure withholding barrier are not implemented by this slice.

## Verification and next work

Evidence is recorded in [the slice ledger](constrained-import-native-runtime-gates.md).
Public acceptance uses the ordinary HTTP host and existing observation inspection,
explicit release-case review and offline verification. The negative selector
controls require typed startup refusal before the host can return an application
URL. Unexpected successful hosts are closed, so an oracle-refutation run cannot
leak an admitted recording server.

On Node `22.19.0` / npm `11.5.2`, unchanged `npm run verify` exited zero with
`verification suite passed`, including package contract/packed consumer, tooling
tests and the locked acceptance manifest. Direct typecheck and three changed JS
syntax checks exited zero. The initial two-test targeted run passed both tests;
the four-mode prepared experiment completed in 25,853 ms, below its unchanged
60,000 ms ceiling.

After full verification, temporarily disabling only selector refusal made the
native public host test fail with `Missing expected rejection` (exit one). Its
unexpectedly admitted host was closed without an application request. The check
was immediately restored; this control is not retained. The affected acceptance
file is rerun after restoration, with results in the ledger. A read-only
independent reviewer found no actionable correctness, scope or Standards issues;
the driver also completed source, boundary, negative-oracle and documentation
passes. This is one bounded slice review, not completed full-G1B Standards/Spec
coverage.

The restored affected acceptance file passed all six tests, with zero failures,
skips or cancellations. Its prepared four-mode test completed in 23,700 ms
(rounded), under the unchanged per-test ceiling. All three scoped manual ledger
gates are met; none is abandoned. Their evidence is reviewed test/source evidence,
not a claim of three independently automated gate-check oracles.

Next extend the independent worker's finite SSR rewrite, source-map finishing,
Node lowering and delivery decoration. Keep this compatibility record separate
from expected-output acquisition. Retain the unguarded late 8 control, compare
after that control, and withhold the complete actual closure before first entry
evaluation; per-module lazy equality is insufficient. Full G1B, C2 diagnostic
ordering, ordinary replay/browser routes and #106/#107 status are unchanged.
