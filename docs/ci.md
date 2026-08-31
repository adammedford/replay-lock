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
