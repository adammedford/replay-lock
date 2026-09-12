# Development capture measurements

Run these maintainer commands from the repository with Node 22 and the locked dependencies. They measure the supported development transform/runtime seams and serial isolated verification. Wall-clock budgets are deliberately outside normal correctness CI.

```sh
npm run build
npm pack --pack-destination /tmp/replaylock-final
npm run bench:dev -- --baseline /path/to/baseline.tgz --final /tmp/replaylock-final/replaylock-0.1.0.tgz --output docs/pilots/performance.json
npm run bench:dev -- --check docs/pilots/performance.json
```

The baseline for issue #64 is the packed development-capture implementation before the usability changes, including the earlier uncommitted V2 work. Its SHA256 is `54ef6aa5b986788844f9c6377a4fdd0b48bdccb1937600537f76ab5ec9801627`. A Git commit alone cannot reproduce this baseline. Keep the tarball with the measurement evidence.

Five pairs alternate baseline/final order on one host. Both packages resolve the same installed dependency tree. Each measurement runs in a fresh Node process against a disposable project. Fixtures contain 10, 100 or 1000 eligible JavaScript modules, all of which are loaded through analysis and source transformation. `coldLoadMs` covers the complete analysis/transform workload, excluding fixture creation, compiler import and HTTP/browser startup. `editToReadyMs` covers saving one source edit, invalidation and transforming that changed module. It excludes browser rendering and reload of unrelated modules. These controlled costs make analysis changes comparable; they are not claims about total application page-load time.

Invocation results include 10,000 calls with capture disabled and enabled, the additional microseconds per call, and a checked observation count. Replay measurements cover 1, 10 and 100 cases, one fresh verification process per case. `--extended` adds 1000-case runs. No native random read is needed during replay: the recorded trace supplies it. Startup, preflight, Vitest and process teardown are included in replay duration. Memory is the maximum resident set reported by Node (`peakKiB`); replay includes measurements from descendants and reports the largest process peak, not a sum of simultaneous process memory.

The explicit checker requires five valid pairs and tests two budgets: median cold-load time for 1000 modules improves by at least 50%, and the 10-module median regresses by no more than the larger of 10% or 20 milliseconds. Replay costs are reported without a speedup promise. The runner saves a `.partial` file after each measurement; incomplete evidence cannot pass the budget checker. Timings vary with host load and should be rerun on the same otherwise idle machine when assessing another change.

Generated conformance runs separately:

```sh
npm run conformance:dev
npm run conformance:dev -- --seed 3 --realm browser
npm run conformance:dev -- --extended
```

The normal suite uses 32 reproducible seeds in Node and Chromium, each under normal, reverse and interleaved settlement orders. It compares original/instrumented completions, native call order/counts and input mutation, then replays captured calls offline. Excluded mutation programs must remain uninstrumented with diagnostics. Shared runtime checks cover observer exceptions, capacity exhaustion and detached work. The extended suite uses 1000 seeds. Failures save their exact generated source and seed under `.replaylock/conformance-failures/`; reduce a failure to a stable acceptance fixture before fixing it.
