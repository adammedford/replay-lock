# Diagnostic CPU profiles

These files explain where time was spent; they are not the latency acceptance runs. See `../responsiveness-profiling.json` for sample summaries, phase labels and SHA-256 hashes. The first four hashes refer to uncompressed JSON; worker hashes refer to the compressed files, as indicated by `sha256Of`.

Baseline profiles used original library commit `2f9ff94`. Recovered profiles used the recovered analysis optimizations before realm workers. Each application process started with an inspector listener on an ephemeral loopback port. After the application listener became available, an inspector session enabled the CPU profiler. The startup interval ran from just before the recording-control start request through the cold page and seeded search navigation. A second profile ran from just before the existing users-route heading edit through its visible browser update. The ordinary pilot cleanup stopped the owned process group and restored the route/configuration.

The worker profiles diagnosed project construction after parallel realm workers and targeted browser invalidation, before SSR transform reuse. They include only individual analysis requests, not browser latency. In a disposable built copy of `dev-analysis-worker.js`, a worker-local `node:inspector` Session enabled and started `Profiler` immediately before a request without `transform`, then stopped and serialized `data.profile` immediately after `project.analyze(environment)`. The request callback stayed synchronous; no other request could mutate the compiler plan during profiling. The startup requests were Node 1/browser 2; edit requests were Node 140/browser 141. Request IDs are workload-dependent and are not protocol constants.

To repeat diagnosis, use the same pinned application and workload as `scripts/bench-dev-browser.mjs`, collect these intervals separately from acceptance, and use a writable output directory. The worker instrumentation can be reproduced around the synchronous analysis call with:

```js
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';

const profiler = new Session();
profiler.connect();
profiler.post('Profiler.enable');
profiler.post('Profiler.start');
const result = project.analyze(environment);
profiler.post('Profiler.stop', (error, data) => {
  if (error) throw error;
  writeFileSync(profilePath, JSON.stringify(data.profile));
});
profiler.disconnect();
```

Compress the resulting JSON with gzip and retain both its identity and the source/build identity. Rebuild with `npm run build` to remove disposable instrumentation before measurements. Do not run profiling concurrently with latency trials. No diagnostic instrumentation is present in the measured final build.
