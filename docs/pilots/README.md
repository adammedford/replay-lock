# Public development-capture pilots

Issue [#64](https://github.com/adammedford/replay-lock/issues/64) uses two pinned public applications. Homer is the browser pilot at `daa017dfe1ea8d0875697aede091319b6134bb4b`; Epic Stack is the SSR pilot at `8473afd804b66dba6a23f317908dc35d1535e90d`. [Baseline evidence](baseline.json) and [final evidence](final.json) contain commands, exit statuses, timings, source and lockfile digests, package versions, counts and blocker categories. A report validator checks that claimed outcomes agree with command evidence. A validated report can describe a blocked pilot; it does not imply a successful capture journey.

```sh
npm run pilot:dev -- --phase baseline --tarball /path/to/baseline.tgz --output docs/pilots/baseline.json
npm run pilot:dev -- --phase final --tarball /path/to/final.tgz --output docs/pilots/final.json
npm run pilot:dev -- --validate docs/pilots/final.json
```

The runner uses disposable checkouts, verifies each commit, installs with the declared package manager and frozen lockfile, and installs the packed library into an isolated consumer. Application package and lockfile bytes must remain unchanged. An optional `--source-cache <directory>` can supply existing `homer` and `epic-stack` Git clones; the required pinned commit is still verified. `--pilot homer` or `--pilot epic-stack` runs one application for diagnosis; complete evidence requires both. Downloads and local browser/server execution require their normal host permissions.

The existing application config is wrapped locally to add `replaylock({ dev: true })`, preserving the original config's relative imports. Capture uses the app's existing `npm run dev`. Workloads target bundled Homer service filtering/local dummy data and Epic Stack's seeded search/profile/notes routes. Browser workload requests are restricted to loopback; no private application or live account data is part of these pilots. A successful workload must produce candidates, explicitly script review of synthetic cases, replay offline, survive a comment-only source edit and detect a seeded return-value regression. Human review duration is `null`: no human timing was measured.

A missing prerequisite, unsupported host/configuration, exclusion or workflow failure stops that pilot with a measured blocker. The runner preserves the evidence rather than upgrading the application's dependencies or weakening capture safety to make it pass. Unsupported syntax and host integration remain follow-up work. Controlled acceptance fixtures separately require successful Node/browser record, review, offline verify and regression detection; blocked public pilots do not replace that coverage.

The paired [performance evidence](performance.json) and its methodology are described in [performance.md](../performance.md). Timing budgets are explicitly invoked; they are not part of ordinary correctness CI.
