# Development capture usability results

The implementation follows [issue #64](https://github.com/adammedford/replay-lock/issues/64). The public-app results below are compatibility findings, not successful adoption trials. Both phases used the same pilot runner, pinned application revisions, declared package managers and unchanged application package/lockfile bytes.

Follow-up: the [Epic Stack scan timeout diagnosis](scan-timeout.md) resolves the scan-exit blocker with the same pinned application and unchanged eligibility counts. The [subsequent pilot](epic-followup.md) passes scanning but remains blocked at recording startup; a separate probe confirms the missing middleware-host discovery boundary. The tables and JSON below remain the original measurements.

| Public application | Baseline | Final | Measured capture/review outcome |
|---|---|---|---|
| Homer `daa017dfe1ea8d0875697aede091319b6134bb4b` | `NO_ELIGIBLE_TARGET` when starting recording | Same blocker | Scan completed with zero eligible targets in both realms. No observations, accepted cases or human review timing. |
| Epic Stack `8473afd804b66dba6a23f317908dc35d1535e90d` | Scan did not exit within 120 seconds | Same blocker | Scan output was emitted, but the command timed out. Capture and subsequent stages were not run; counts remain unmeasured. |

The Epic Stack child exited with status zero after timeout termination. The runner separately records `errorCode: TIMEOUT`, so that exit cannot be interpreted as success. The report validator rejects fabricated passing stages, dependency drift, missing command evidence and unperformed capture/replay counts.

Homer's source includes Vue single-file components outside the current JavaScript/TypeScript callable boundary. Investigating that language integration is separate compatibility work. For Epic Stack, investigate handles retained while loading/scanning its Vite configuration before attempting its existing seeded-user and notes workflows. Neither application was upgraded or rewritten to manufacture a successful pilot.

Raw evidence: [baseline](baseline.json), [final](final.json). The baseline ReplayLock tarball SHA256 is `54ef6aa5b986788844f9c6377a4fdd0b48bdccb1937600537f76ab5ec9801627`; the final tarball is `1d2f070acda8b5a873d934f4adb98d38d4d7a4ce59d30a0ac2bab0f3fd1cc84f`. Reproduction commands and evidence interpretation are in the [pilot guide](README.md).

Controlled acceptance journeys separately require successful Node/browser recording, explicit synthetic-case review, offline replay and seeded regression detection. Retention checks exercise 10,000 completed calls with fresh native reads and two retained same-group correlations. Reporting checks force both observation-write and counter-checkpoint failures, then lose an acknowledgement: retrying must not inflate invocation or observation counters. Recovery reconciles sealed observations with a potentially older report checkpoint and marks unavailable counts unknown.

## Verification

Node 22.19.0 type checking and `npm run verify -- --reporter=spec` passed, including the locked 45-file acceptance suite, verification tooling and packed-consumer checks. The extended command `npm run conformance:dev -- --extended` passed 1,000 seeds with three settlement schedules in each realm. Each realm executed 3,000 programs, replayed 2,625 offline, excluded 375 unsupported programs and exercised 249 throws. Both also passed observer-failure, pending-capacity and detached-execution checks. The [extended conformance report](conformance.json) records the seeds and counts.

## Paired performance measurements

Five alternating baseline/final pairs on the same host passed both performance budgets. These measurements cover analysis plus all source transforms, not full browser page load. Some measurements overlapped other validation on the host; this was not an otherwise idle machine. Raw runs, environment and package digests are in the [performance report](performance.json).

| Modules | Baseline cold (ms) | Final cold (ms) | Baseline edit (ms) | Final edit (ms) |
|---|---:|---:|---:|---:|
| 10 | 51.23 | 22.96 | 3.30 | 4.14 |
| 100 | 846.87 | 70.38 | 8.25 | 18.25 |
| 1000 | 67123.56 | 1405.80 | 71.91 | 94.37 |

The 1,000-module median improved by 97.91%, exceeding the required 50%. The 10-module result also met its regression budget.

| Replay cases | Baseline (ms) | Final (ms) | Baseline peak (KiB) | Final peak (KiB) |
|---|---:|---:|---:|---:|
| 1 | 702.75 | 712.75 | 189856.00 | 194656.00 |
| 10 | 5018.90 | 5007.37 | 193120.00 | 197200.00 |
| 100 | 47342.49 | 48079.11 | 195184.00 | 198464.00 |

All table values are medians. Edit timing ends after invalidation and transformation of the changed module. Replay uses fresh serial processes; peak memory is the largest individual process peak, not aggregate concurrent memory. Replay costs are reported without an improvement claim.

## Middleware-host follow-up

The [Epic Stack middleware follow-up](epic-middleware.md) documents parent-listener integration and the subsequent seeded workload run. Its [separate evidence](epic-middleware.json) preserves the original baseline/final comparisons above.
