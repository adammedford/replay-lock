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
