# Real-application pilots after the analyzer-yield work (2026-09-23)

Epic Stack now completes the whole development-capture journey for the first time. Homer is still blocked, as it was in the [final evidence](final.json). BMI still passes and has gained a case. All three used one package build:

- `replaylock-0.1.0.tgz`, SHA-256 `84b2097db05b15247e9df66929d3bfb84a4b4d12a3b61078f3738f4d91cd94c2`
- Node 22.19.0, macOS arm64

That build is `main` plus these changes:

| Change | Why the pilots needed it |
|---|---|
| [#97](https://github.com/adammedford/replay-lock/pull/97) | Browser replay on Windows, and a consistent spelling for development paths. |
| [#98](https://github.com/adammedford/replay-lock/pull/98) | Namespace objects and built-in key reads taint only their declaration. On Epic, eligibility goes from 9 to 19 per realm, including `getUserImgSrc`. |
| Replay isolation | Replay resolves `vitest` from ReplayLock's own copy; Epic pins Vitest 4.0.18. Case modules are scanned for dependencies before browser cases run. The CLI and replay workers exit when application plugins keep handles open. |
| Namespace additions | reflect-metadata's additions to `Reflect` (loaded by tsyringe in Epic's server) no longer block Node-realm capture. |

## Epic Stack at `8473afd`: passed

`node scripts/pilot-dev.mjs --phase final --pilot all --tarball <build> --keep-workspace`, with the four existing workflows: seeded user search, missing-user search, profile navigation, notes navigation.

| Stage | Result |
|---|---|
| Scan | 19 eligible callables in each realm; 1,802 Node and 1,788 browser findings skipped |
| Record | 24 observations, 6 candidates; no integrity blocks |
| Review (scripted `a`) | 6 accepted |
| Offline replay, native network blocked | 6 verified |
| Comment-only edit | 6 verified |
| Seeded return regression | detected, `OUTPUT_MISMATCH` |

The accepted cases are `getUserImgSrc("user/kody.png") → "/resources/images?objectKey=user%2Fkody.png"`, `isUser(null) → null`, and the marketing route's `meta() → [{ title: "Epic Notes" }]`, each in both the browser and Node realms. This meets the acceptance checks in [capture-opportunity.md](capture-opportunity.md#decision-and-handoff). Review was scripted, so no human review time was measured.

The pilot runner's recording gate now accepts value blocks: `UNSUPPORTED_VALUE`, `UNSUPPORTED_EFFECT`, `SENSITIVE_VALUE`, `OVERSIZED_OBSERVATION`, `MUTATED_INPUT` and `VALUE_ADAPTER_*`. Each one leaves a single observation out of an otherwise sound session, which is the standard the BMI journey was accepted under. Integrity blocks still fail the pilot: `INTRINSIC_MODIFIED`, `INCOMPLETE_OBSERVATION`, `STORAGE_FAILURE`, `PENDING_LIMIT` and `GENERATION_MISMATCH`. The runner reads block codes from `replaylock report --session <id> --json`.

## Homer at `daa017d`: blocked, unchanged

Homer's only JavaScript callable, `src/mixins/service.js#mergeHeaders`, is still skipped for `EFFECTFUL_INITIALIZATION`; `UNKNOWN_CALL` no longer applies. Its application code is Vue single-file components, which development capture does not analyze.

## BMI at `5b32cf9`: passed, one more case

The run used the owned recording, a scripted review, and [validation](bmi-validation.json). It retained three candidates. The new one is `calculateBMI(70, 170) → 24.2`, which the analyzer changes made capturable. All three passed offline replay and the comment-only edit. The seeded `getBMICategory` threshold regression failed with `OUTPUT_MISMATCH`, and the source was restored. The session is partial for the same reason as before: 16 `UNSUPPORTED_VALUE` blocks and 1 `INCOMPLETE_OBSERVATION` during invalid form states ([recording](bmi-owned-record.json)).

Keep pilot workspaces outside this repository. Node resolution from an application inside it reaches this repository's own `node_modules/vitest`. Before the replay-isolation change, that loaded a second Vitest into browser replay.

## Evidence not committed

The complete pilot report is 850 KB, of which 789 KB is Epic's scan listing. It is kept outside the repository, SHA-256 `93e2402f2093619540cb91b2407b45a96f432d5c8f4c5116a7175c363ab6d4e3`, and validates with `npm run pilot:dev -- --validate <report>`. [final.json](final.json) still holds the previous final run.

## Browser latency budget: fails

`scripts/bench-dev-browser.mjs` was run on the prepared Epic workspace from the pilot above: five alternating pairs, Vite cache removed before each run. `scripts/check-browser-budget.mjs` was checked against the [adopted budget](responsiveness-budget.json). Each figure is the median time the plugin adds:

| Build | Cold page | Navigation | Visible HMR |
|---|---|---|---|
| Budget | 2,000 ms | 100 ms | 2,000 ms |
| `3ab46b4`, before the analyzer-yield stack | 1,938 ms | 32 ms | 1,151 ms |
| `2736a7e`, current `main` | **9,004 ms** | 36 ms | **3,426 ms** |
| Pilot build above | **9,983 ms** | **2,870 ms** | **7,670 ms** |

The `3ab46b4` run reproduces the last recorded measurement (1,970 ms cold page), so the bench is still sound on this host.

The analyzer-yield stack (#87–#96) raised cold-page and HMR overhead on `main` without being measured. The pilot build adds navigation and HMR cost. The likely cause: Epic's visited pages now capture calls in both realms, while before these changes nothing on them was eligible. The budget has not yet measured recording cost with real observations. Both regressions need profiling before the budget can be met again.
