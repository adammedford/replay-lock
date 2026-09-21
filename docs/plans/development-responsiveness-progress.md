# Development responsiveness progress

Parent: [#72](https://github.com/adammedford/replay-lock/issues/72). Implementation: [draft PR #80](https://github.com/adammedford/replay-lock/pull/80).

- [x] #73: fresh five-pair baseline and separate startup/edit profiles retained.
- [x] #74: optimization implementation, independent equivalence fixtures and full local safety verification complete.
- [x] #75 local gates: five-pair evidence passes every ceiling; typecheck, full verification and dogfood pass.

The remaining merge gate is the final PR revision's hosted `verify` check. Its authoritative status is attached to PR #80; the spec and tickets close on merge, after that check passes.

## Workspace recovery

The temporary implementation checkout and prepared pilot from the earlier run disappeared. The relocated IsPure directory has source files but no readable commit history. Neither directory was repaired or overwritten. Work resumed in a persistent clone at `/Users/adammedford/Projects/replaylock-responsiveness`, branching from `2f9ff9467608a458e4f37ddc53aec3a6c40d28af`. The pinned Epic workload was rebuilt at `/Users/adammedford/Projects/replaylock-responsiveness-pilot` from `8473afd804b66dba6a23f317908dc35d1535e90d` and its unchanged dependency lockfile. New baseline and optimized measurements use that same host integration; unavailable historical raw trials are not acceptance evidence.

Main commit `c8293220797da8c77ac2caab0dd3de3e3f81efe4` was merged, retaining its safety changes. Full Node 22 verification, typecheck, dogfood and hosted CI passed for merge commit `f058499`. The final measured implementation `7edfc6a` subsequently passed Node 22 typecheck, the complete verification suite (including package contract and packed consumer), dogfood, evidence validation, the adopted budget checker and diff checks.

## Current implementation

Per-build source facts, tracked filesystem reads, parent-directory validation of absent resolution probes, TypeScript resolution caching and selected/transitive callable analysis reduce repeated work. Authored admission and transformation share a validated snapshot. A fresh source read can prove a module remains excluded by its own initialization effects; every other admission decision validates all tracked inputs.

Session-owned workers isolate Node and browser compiler state while analyzing both realms concurrently. Stale async results cannot authorize a newer generation. Shutdown rejects new starts, cancels worker work and joins in-progress startup.

Full reloads remain. Changed modules and previously/newly captured modules receive hard transform invalidation. Unchanged browser transforms remain reusable. Vite soft invalidation resets all server evaluation state while retaining unchanged transforms. Configuration or adapter changes retain full hard invalidation.

Independent original-build fixtures compare diagnostics, positions, transformations, source maps and digests. Focused tests also cover freshness without watcher events, missing files, symlinks, replacements, source overlays, worker lifetime, newly eligible functions, unchanged-function generations, SSR state reset and startup cancellation.

## Evidence status

Raw baseline and worker-stage five-pair reports, identities and separate CPU profiles are retained under `docs/pilots/responsiveness-*`. The worker-stage edit overhead was **2424.635 ms**, exceeding the **2000 ms** ceiling; that failed result remains available. The final five alternating pairs at `7edfc6a` all completed with cleanup and passed the adopted ceilings: **673.992 ms cold page**, **19.434 ms navigation**, and **1205.812 ms visible edit** added medians. Baseline and final application identities match. No target has been relaxed. See [retained evidence](../pilots/responsiveness.md).

Final standards review found no hard violations; two optional helper-extraction suggestions were deferred. Spec review found SSR reset and startup/shutdown races during development; both were fixed and covered by public integration regressions. Follow-up static review found no further blocking issues.
