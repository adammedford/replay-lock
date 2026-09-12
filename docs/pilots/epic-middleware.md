# Epic Stack middleware-host follow-up

This follow-up addresses the listener-discovery blocker in [the scan follow-up](epic-followup.json). The original [baseline and final results](results.md) remain historical evidence.

ReplayLock now discovers the parent HTTP listener supplied through Vite's `server.middlewareMode: { server }`. It publishes its authenticated control endpoint whether that listener starts before or after Vite, removes discovery state when either owner closes, and leaves an externally owned listener open when Vite closes. A controlled acceptance journey covers browser and Node capture, review, and offline replay through this integration.

The pilot uses Epic Stack revision `8473afd804b66dba6a23f317908dc35d1535e90d`. Its bootstrap creates a Node HTTP server around the existing Express app, passes that server to Vite middleware and HMR, and listens on loopback. Sharing the HMR listener avoids Vite's shared default WebSocket port and carries browser stop acknowledgements. The runner checks the exact source shape before applying this edit and records before/after hashes. Application business logic, package manifest, and lockfile remain unchanged. Local setup copies the pinned public example environment, creates the SQLite file, deploys the bundled migrations, generates Prisma SQL, and seeds the bundled synthetic users and notes.

The workload exercises seeded-user search, missing-user search, the seeded profile, and its notes link. The notes selector targets the profile's `/users/kody/notes` URL; the site's “Epic Notes” logo leads home and is not the intended link.

Three recording defects were exposed and fixed during diagnosis:

- Diagnostic prose containing `getPassword: ...` triggered credential-value rejection during session startup. Reports now retain validated diagnostic codes and structured locations instead of arbitrary message text; value-secret checks remain enabled.
- Already-excluded modules repeatedly triggered whole-project analysis of transformed overlays. The plugin now checks current authored eligibility first, while eligible overlays still receive full validation. Tests cover eligibility changes after edits.
- A transient reset of the controller's status connection ended recording and stopped the launched app. Status polling now retries only socket-reset failures, at most twice. Start and stop requests are not retried. A regression test destroys the first status socket and checks that recording survives.

A diagnostic run completed all four workflows, then stopped with zero observations, zero candidates, and seven `UNSUPPORTED_VALUE` blocks. Its session report attributed all seven to Node `app/utils/timing.server.ts#createTimer`: the return object contains an `end` function closing over timer state. This value cannot be serialized by the current portable-value contract. No privacy rule or value boundary was relaxed to manufacture candidates.

The runner canonicalizes macOS temporary-directory aliases before configuring Vite's filesystem allow list. Navigation has a bounded 120-second cold-start budget, within a 300-second recording-probe budget. These are pilot limits, not performance claims.

The clean packed rerun is recorded in [epic-middleware.json](epic-middleware.json): all four workflows passed, browser modules returned HTTP 200, and stopping reported zero observations, zero candidates, and seven recording blocks. The tarball SHA256 is `efaa2b985195b2a6cf6312a988db0db7e8d7f1cb14e7da01c9ba1d5894b6753f`. Its remaining detached npm application group required an explicit SIGTERM after capture had finished; command duration includes that cleanup delay. Reliable unattended process cleanup remains a follow-up, and this run is not evidence of a fully unattended successful journey. A validated evidence file does not imply a successful characterization journey: zero candidates prevent review, offline replay, and regression verification for this workload. The remaining adoption question is how to select useful supported callables or model stateful returned objects without claiming their closures are portable.

Reproduce with Node 22 and the final tarball:

```sh
node scripts/pilot-dev.mjs --phase final --pilot epic-stack \
  --tarball /absolute/path/replaylock-0.1.0.tgz \
  --output docs/pilots/epic-middleware.json
```

An optional `--source-cache` can supply the pinned checkout; `--keep-workspace` retains a diagnostic workspace. The JSON records the actual package digest, runner digest, source hashes, commands, workflow outcomes, and blocked stage.

Final library validation passed under Node 22.19.0: the 12 development integration tests, type checking, and `npm run verify`, including the locked 45-file acceptance suite and packed-consumer verification. The middleware acceptance case explicitly shares the HMR listener and verifies zero recording blocks before review and offline replay.
