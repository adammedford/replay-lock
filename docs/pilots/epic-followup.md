# Epic Stack pilot after the scan fix

The 2026-09-11 run used pinned revision `8473afd804b66dba6a23f317908dc35d1535e90d`, Node 22.19.0, and packed ReplayLock SHA256 `d88580d79f1eace1ee95d689d0ff9fd4530a437fec480bfb42068e0d259684bf`. Application package and lockfile bytes were unchanged. [Raw evidence](epic-followup.json) records the commands, environment, timings, digests and outcomes.

| Stage | Outcome |
|---|---|
| Checkout and installation | Passed with pinned revision and frozen dependencies |
| Scan | Passed in 14.67 seconds; 2 eligible targets per realm; 1,543 Node and 1,536 browser exclusion findings |
| Recording startup | Failed with `PLUGIN_NOT_ACTIVE` |
| Workload, review, offline replay, refactor and regression checks | Not run |

The pilot report passed validation. This validates the evidence structure, not a successful capture journey. Observation, candidate, accepted-case and replay counts remain unknown; human review time was not measured.

## Confirmed integration gap

Epic Stack's `server/index.ts` creates Vite with `server.middlewareMode: true`, mounts its middleware in Express, and starts a separate Express HTTP listener. ReplayLock currently publishes its discovery manifest from `vite.httpServer`'s `listening` event. In middleware mode that server is null, so the publication path cannot discover the external listener.

A minimal probe using the actual ReplayLock plugin, a Vite middleware server and a separate local HTTP listener produced:

```json
{"hostListening":true,"viteHttpServer":null,"manifests":0}
```

This independently establishes a missing integration boundary. The real application log also included `killed by timeout (10000ms)` before the recording failure. Its source has not been established, so the middleware gap is not claimed to explain every part of that startup failure.

## Next implementation boundary

Support an explicitly supplied external HTTP server or local origin for middleware-host discovery, including authentication, URL validation and shutdown cleanup. Lock it down with a minimal Express/Vite capture → review → offline replay test before rerunning Epic Stack. This is additional host integration, outside the completed scan-timeout fix.

The pilot runner also needs Epic Stack's documented local environment/database setup and seeded users before its search/profile/notes workload can be evaluated. Installation alone does not establish these prerequisites. Their absence was not diagnosed as the cause of this startup failure.

Reproduction after building and packing the library:

```sh
node scripts/pilot-dev.mjs --phase final --pilot epic-stack \
  --tarball /absolute/path/to/replaylock.tgz \
  --source-cache .unlazy/dev-usability/pilot-sources \
  --output /tmp/epic-followup.json
```

The optional source cache must contain the pinned public clone. This is a single-application follow-up, not a replacement for the earlier two-application baseline/final reports.
