# Epic Stack scan timeout diagnosis

## Reproduction

The pinned Epic Stack revision `8473afd804b66dba6a23f317908dc35d1535e90d` emitted both scan summaries but remained alive. The original pilot terminated it after 120 seconds; its eventual status zero did not mean the command completed naturally.

A local feedback loop ran the public `scan --dev` command and required exit within two seconds after the browser summary. Before the fix it failed with:

```json
{"summaries":["Scanned node: 2 eligible, 1543 skipped findings","Scanned browser: 2 eligible, 1536 skipped findings"],"code":0,"signal":null,"timedOut":true}
```

Restricting capture to one identity function preserved the failure. Keeping only the React Router plugin also preserved it. Removing that plugin made this reduced configuration exit normally.

## Causes and fix

Two separate resource lifecycles were involved:

1. The React Router plugin starts development configuration/type-generation watchers in its configuration hook and closes them through `buildEnd`. ReplayLock used Vite's `resolveConfig` without a server lifecycle, so those shutdown hooks never ran. Standalone configuration loading now owns a non-listening Vite server and closes it in `finally`. Existing server callers continue to use their supplied resolved configuration.
2. The pinned `react-router-devtools` package creates a separate Vite server at module import time. Closing the host server cannot dispose of resources it does not own. Removing this package made the full reduced scan exit; adding it back preserved the failure even with host-server cleanup.

The public scan now runs in an owned subprocess, including automatic development-plugin detection. After output is flushed, the worker sends an explicit completion status. The parent disposes of that subprocess and its ordinary descendants and then exits with the scan status. On POSIX systems it signals the owned process group, then finishes cleanup with `SIGKILL` after a short grace period; Windows uses `taskkill /T /F`. A worker that exits without a completion message is an infrastructure failure, even if its exit code is zero. Interruptions also request cleanup.

This is resource containment for local configuration evaluation, not a security sandbox. Deliberately detached processes are outside the owned process group. The original-application verification here was on macOS with Node 22.19.0; Windows behavior remains covered by the repository's compatibility lane rather than a local result.

## Regression coverage and original-app result

The tests in `test/acceptance/dev-reporting.test.mjs` exercise the public CLI with:

- A timer acquired by a configuration hook and released through Vite shutdown, on success and invalid-policy paths.
- Import-time resources and a plugin child process that ignores `SIGTERM`; successful scan output must remain valid JSON and the child must be gone.
- A configuration exception while resources are live.
- A premature zero-status worker exit, which must fail without claiming a completed scan.

Both resource-leak tests were observed failing before their respective fixes. The focused tests can be rerun after building with:

```sh
node --test --test-name-pattern='scan disposes|development scan closes' test/acceptance/dev-reporting.test.mjs
```

The original full application configuration was restored, including every original plugin, and the feedback loop passed:

```json
{"summaries":["Scanned node: 2 eligible, 1543 skipped findings","Scanned browser: 2 eligible, 1536 skipped findings"],"code":0,"signal":null,"timedOut":false}
```

Application dependency declarations and the lockfile were unchanged. This resolves the scan timeout; recording, review, offline replay and actual adoption in Epic Stack remain separate follow-up work. The earlier baseline/final pilot JSON files describe immutable historical measurements and have not been rewritten.

Final validation passed under Node 22.19.0: `npm run typecheck` and `npm run verify`, including all 45 locked acceptance files and packed-consumer checks. The original full-application feedback loop passed twice after process isolation was added. No diagnostic instrumentation remains in the library or tests.
