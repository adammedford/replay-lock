# Development responsiveness evidence

[Spec #72](https://github.com/adammedford/replay-lock/issues/72) adopted ceilings of 2000 ms added median cold page load, 100 ms navigation and 2000 ms visible edit. The final five-pair report meets all three. Full browser reloads and SSR state resets remain; this does not introduce state-preserving HMR.

| Stage | Cold page overhead | Navigation overhead | Visible edit overhead | Budget |
| --- | ---: | ---: | ---: | --- |
| baseline | 2,962.296 ms | 101.111 ms | 14,928.825 ms | Fail |
| workers | 618.239 ms | 23.924 ms | 2,424.635 ms | Fail |
| transform reuse | 673.992 ms | 19.434 ms | 1,205.812 ms | Pass |
| final | 1,969.564 ms | 20.030 ms | 1,189.597 ms | Pass |

## Method and identities

Each report contains five alternating enabled/disabled pairs with a fresh server and browser and a cold Vite dependency cache. No tests, other pilots or profiling ran concurrently with these measurements. Every trial completed and its owned process group exited. The original benchmark runner is unchanged. Its negative controls and the explicit budget checker remain separate from correctness CI.

The workload is Epic Stack `8473afd804b66dba6a23f317908dc35d1535e90d`, its pinned dependency lockfile and synthetic seeded data. Baseline and final application manifest, dependency lockfile, server integration and original Vite configuration hashes match. Library baseline is `2f9ff9467608a458e4f37ddc53aec3a6c40d28af`; the final measured implementation is `1a58da3`. Main safety fixes through `c829322` are included in the final implementation. Source and built-file hashes distinguish each measured version.

This is a fresh paired baseline in the recovered persistent checkout. Older adoption reports remain unchanged; missing historical temporary results are not used as acceptance evidence. Cold-load outliers remain in the raw samples. The final cold-load result has only 30.436 ms of margin below its ceiling, so the passing result should not be read as a robust margin across hosts or repeated runs. The conclusion is specific to this pinned workload and host, not a universal latency guarantee.

- [Baseline samples](responsiveness-baseline.json) and [identity](responsiveness-baseline-identity.json).
- [Earlier worker-stage samples](responsiveness-workers.json) and [identity](responsiveness-workers-identity.json), retained despite exceeding the edit ceiling.
- [Prior transform-reuse samples](responsiveness-transform-reuse.json) and [identity](responsiveness-transform-reuse-identity.json), measured before the shutdown race fix.
- [Final samples](responsiveness-final.json), [identity](responsiveness-final-identity.json), and [adopted budget](responsiveness-budget.json).
- [Separate profiling summary](responsiveness-profiling.json) links retained compressed CPU profiles. `sha256Of` distinguishes compressed-file hashes from uncompressed-profile hashes. Profiles are diagnostic, not acceptance timings.

## Changes and safety evidence

Per-build effect facts, filesystem inputs and resolution results are reused. Only selected callables and their transitive callees receive callable analysis; import initialization remains unconditional. Every admitted transform uses a fully validated filesystem snapshot, including missing resolution probes and replacements. A narrow exclusion shortcut freshly reads authored source before relying on a source-only initialization finding.

Node and browser workers own separate compiler state, reject stale generations and close with the session. Start and stop lifecycle checks prevent shutdown from recreating workers or reinstalling runtime callbacks. No compiler state is shared across builds.

An edit hard-invalidates changed modules and all previously/newly eligible capture modules. Vite soft invalidation resets SSR evaluation while preserving unchanged transform output; the browser still reloads completely. Configuration and adapter changes retain complete hard invalidation. Public integration tests assert newly eligible captures, unchanged-function generation refresh, unrelated transform reuse, fresh SSR state and cancellation of startup during configuration loading.

Independent fixtures generated from the original implementation compare findings and positions, complete project diagnostics, transformed output, source maps and digests. Freshness tests exercise changes without watcher delivery, restored mtime, missing imports, added files, replacement directories, dangling symlinks and isolated overlays. Existing public record → review → offline verify and regression workflows remain required.

## Hosted regression and final build

The first final hosted run at `abc7642` cancelled the worker-lifecycle test because a promise remained pending after the event loop drained. A real reply queued during `Worker.terminate()` could unreference the worker while shutdown awaited its exit. Commit `1a58da3` prevents all reference releases after closing starts. A subprocess regression queues a real reply, delivers it immediately after termination begins, and requires shutdown/request completion; it fails before the fix and passes after it. All twelve cache/worker tests pass. Five new pairs were collected on this exact build; the earlier passing report remains retained separately. Final full local and hosted results are recorded on PR #80.

## Reproduce validation

```sh
node scripts/bench-dev-browser.mjs --check docs/pilots/responsiveness-final.json
node scripts/check-browser-budget.mjs docs/pilots/responsiveness-final.json docs/pilots/responsiveness-budget.json
npm run typecheck
npm run verify
npm run verify:dogfood
```

Use the repository Node 22 toolchain. Full local and hosted verification status is tracked in [implementation progress](../plans/development-responsiveness-progress.md) and [PR #80](https://github.com/adammedford/replay-lock/pull/80). Timing budgets remain explicitly invoked, outside ordinary CI.
