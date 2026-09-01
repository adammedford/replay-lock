# Gating CI on `replaylock verify`

`verify` is designed to run as a CI check: it parses and preflights the complete accepted set before any target runs, then replays each one in a disposable fresh Vitest process. This page states the exit-code contract a CI pipeline should route on in one place; a copy-pasteable example lives at [`examples/github-actions/replaylock-verify.yml`](../examples/github-actions/replaylock-verify.yml).

## The exit-code contract

- **`0`** — every accepted case verified. Nothing to do.
- **`1`** — a real behavioral regression: an accepted case's completion changed. **Block the merge** and review the `OUTPUT_MISMATCH` / `COMPLETION_KIND_MISMATCH` diff in the log — this means application behavior actually changed since the case was accepted.
- **`2`** — infrastructure, configuration, or policy failure: a stale assumption, an orphaned callable, an invalid adapter or trusted-package catalog, a storage failure, or a malformed accepted artifact. **Block the merge**, but the investigation is different: this means something about ReplayLock's own setup needs attention, not necessarily that application behavior changed. See [Troubleshooting](troubleshooting.md) for the specific diagnostic code.

Both `1` and `2` should fail the CI check — a pipeline should never treat `2` as "safe to ignore." The distinction matters for *how a human investigates the failure*, not for whether the merge is blocked.

## The example workflow

[`examples/github-actions/replaylock-verify.yml`](../examples/github-actions/replaylock-verify.yml) runs `replaylock verify` on every pull request and push to `main`, and writes a distinct, human-readable line to the GitHub Actions step summary for each of the three cases above before re-exiting with the same code — so the check still fails on `1` or `2`, but a reviewer opening the summary immediately knows which kind of failure they're looking at. Copy both that file and its companion [`report-verify-exit.sh`](../examples/github-actions/report-verify-exit.sh) into your own project's `.github/workflows/`.

The example assumes `replaylock` is an installed dependency and your accepted cases are committed under `.replaylock/cases/`, per [Artifacts and privacy](../README.md#artifacts-and-privacy).

The example pins Node 22.19.0, npm 11.5.2, and reviewed Action commits. It grants only repository read access, limits a job to fifteen minutes, and cancels superseded pull-request runs without canceling pushes to `main`. It explicitly disables `setup-node`'s automatic package-manager cache: consumer repositories should choose caching deliberately for their own lockfile. ReplayLock's own CI explicitly caches npm's download cache using its committed lockfile; neither workflow caches `node_modules`, and `npm ci` still performs a clean installation.

## Developing ReplayLock itself

The required `verify` job uses `.nvmrc` and the pinned npm version, then runs type checking and `npm run verify`. Full verification runs CLI-runner regression tests, builds and checks the package contract, installs a real packed tarball into a clean temporary consumer, and runs every file in the locked 35-file acceptance suite. The installed consumer exercises public imports and the executable CLI through natural recording, explicit review, successful replay, and a seeded behavioral mismatch; its accepted bytes must never change during verification.

Acceptance files run with bounded concurrency two by default. Reproduce serially or request readable output with:

```sh
npm run verify -- --concurrency=1 --reporter=spec
```

The runner accepts only `--concurrency=1|2`, `--reporter=dot|spec`, and optional `--junit=<absolute-path>`; unknown, duplicate, or invalid runner options fail before its package build. CI uses spec output and a simultaneous JUnit report. Only failed verification runs upload that report, for seven days. A failure before acceptance begins may have no JUnit file; the step log remains authoritative.

Weekly grouped Action updates and monthly ungrouped npm updates arrive through Dependabot, with at most two and three open version-update PRs respectively. Updates still require human review and a green `verify` check; auto-merge is disabled. Dependency versions are deliberately checked by the package contract, so review an npm update together with its compatibility evidence and any affected runtime provenance or reviewed assumptions.

## Scheduled compatibility and coverage

The Monday 06:17 UTC compatibility workflow (also manually runnable) checks Windows and macOS with `.nvmrc` and the full concurrency-two verification suite. A third Ubuntu lane runs type checking and the installed-package smoke check on minimum-supported Node 22.12.0. All three lanes report independently; none adds a required pull-request check or another supported Node major.

The Tuesday 06:17 UTC coverage workflow (also manually runnable) uses exactly `c8@12.0.0` and the complete verification suite on Ubuntu. Reproduce it with the repository toolchain:

```sh
npm ci
npm run coverage
```

Each run prints a fresh directory under ignored `coverage/run-*`. Open its `index.html`, use `lcov.info` in an editor, or inspect `coverage-final.json` and `coverage-summary.json`. `integrity.json` records measured child-process evidence, while `collection.json` records the command, tool versions, and source/lock fingerprint. CI retains these reports for fourteen days and writes a concise summary. Coverage is informational: there is no coverage-percentage gate or third-party upload.

The collector passes a fresh temporary `NODE_V8_COVERAGE` directory through the full process tree, including ReplayLock CLI children, Vite coordinators, and Vitest workers. It checks actual child execution before discarding the raw data, merges only this checkout's source/build records, and remaps build source maps to TypeScript. Every tracked `src/**/*.ts` file must appear, even when never loaded; compiled `dist` paths and installed or copied fixture sources must not appear. Missing worker evidence or an incomplete report fails the coverage run rather than publishing misleading percentages. The fast integrity and remapping regression tests also run during ordinary verification; they do not recursively collect the full suite.

Vitest terminates its workers instead of letting Node exit normally. A coverage-only preload flushes native V8 counters when the pinned Vitest worker acknowledges shutdown, before that termination. It does not change application code, signals, or exit status. Real fork/thread tests guard this version-sensitive shutdown protocol. Each required child witness must also have a positive named-function count in the remapped TypeScript report, so merely listing zero-filled files cannot certify a broken source-map pipeline.
