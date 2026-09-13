# Development recording

Development capture observes natural calls in a local Vite application. It saves reviewed characterization cases using this contract:

`callable + arguments + ordered external reads → return or throw completion`

Each live invocation calls the real source once. Two calls to `quote(10)` can therefore record different `Math.random()` values and different returns. Replay consumes the external trace belonging to each case, without contacting the original source. Extra, missing, reordered, or changed effect calls fail with `EFFECT_TRACE_MISMATCH`, even when application code catches the immediate error.

## Start and attach

Use Node 22 and add the development plugin to the Vite configuration your application runs:

```ts
import { defineConfig } from "vite";
import { replaylock } from "replaylock/vite";

export default defineConfig({ plugins: [replaylock({ dev: true })] });
```

```sh
replaylock scan --dev
replaylock record -- npm run dev
```

Use the application normally. Ctrl-C stops new capture, allows up to five seconds for in-flight calls and browser delivery, and forms pending candidates. A launch recording also stops its child server. To keep an existing server running, attach instead:

```sh
replaylock record --attach http://localhost:5173/
```

The URL must be local HTTP and include the configured Vite base path. Attach requires the plugin to be installed and the CLI to run in the same project directory. The plugin publishes an owner-only discovery file under `.replaylock/dev/`; control requests use its token and browser delivery uses a separate session token. The collector rejects remote hosts and foreign origins. Multiple tabs can contribute to one session; acknowledged envelopes are deduplicated after delivery retries. A bounded browser `sessionStorage` queue retains unacknowledged envelopes across reloads and removes them after acknowledgement. If that storage is unavailable, capture reports a warning and uses its in-memory queue.

Then review and verify:

```sh
replaylock review
replaylock verify
```

Review shows the explicit arguments, full external trace, completion, and provenance. Accept, reject, or skip each candidate. Exact comparison is the default; numeric tolerance is an explicit per-case review choice. Changing an accepted expectation requires a displayed replacement and confirmation. Recording and verification never update accepted expectations automatically.

## Selection and configuration

Automatic selection includes supported module exports, private module functions, and named nested functions whose behavior does not depend on an enclosing invocation. Private replay locators use lexical names, so moving lines does not invalidate a case. A nested function is replayed without calling its enclosing owner. Captured enclosing variables, `this`, generators, unknown callbacks, timers, detached work, writes, streams, mutable module state, and unsafe module initialization remain ineligible.

Ordinary `async`/`await`, analyzed local calls, and supported `Promise.all` calls retain their own invocation context. Nested traces include their children's reads. Parent and child observations can each become independent cases. Browser execution and Node execution produce separate cases.

Configuration belongs in `replaylock.config.ts` (or a supported JavaScript configuration extension):

```ts
import { defineReplayLock } from "replaylock";

export default defineReplayLock({
  capture: {
    mode: "automatic", // Use "annotated" to require @replaylock capture.
    include: ["src/**"],
    exclude: ["src/generated/**"],
  },
  effects: {
    randomness: true,
    time: true,
    fetch: true,
    filesystem: true,
    environment: ["APP_REGION", "VITE_REGION"],
  },
  valueAdapters: [],
});
```

Randomness, time, fetch, and filesystem reads default to enabled. No environment variables are enabled by default. Include defaults to project source; dependency, output, test, configuration, and ReplayLock data directories are excluded. Supplying an exclusion list replaces that default list. Source `@replaylock exclude <reason>` directives still apply. Development mode does not treat `assume-pure` as permission to replay an unrecognized effect.

Analysis recognizes lexical aliases of supported builtins and local imports. Vite string aliases are resolved with exact and slash-prefix matching. User regex aliases and custom alias resolvers block development instrumentation; framework-specific virtual modules remain ineligible when static analysis cannot establish their source. `scan --dev` reports both Node and browser findings without invoking target functions.

## Supported external reads

| Source | Captured behavior |
| --- | --- |
| `Math.random()`, `crypto.randomUUID()` | Each invocation's fresh result, including supported Node crypto imports |
| `Date.now()`, `new Date()`, `Date()`, `performance.now()` | The observed clock value; explicit-argument Date construction stays ordinary computation |
| `fetch(url, init?)` | String URLs using GET/HEAD, visible response status, headers, URL, redirect and type metadata |
| `response.json()`, `.text()`, `.arrayBuffer()` | Only the body reader actually called by the application; the recorder never consumes an extra body |
| `fs.readFileSync`, `fs/promises.readFile`, `fs.promises.readFile` | Returned text/bytes or thrown/rejected read errors |
| `process.env.NAME`, `import.meta.env.NAME` | Individually configured keys, read during the invocation |

Fetch requests with bodies, abort signals, `Request`/`URL` objects, unsupported headers, opaque responses, stream readers, or writes remain unsupported. Callback-based filesystem APIs and arbitrary scheduling are excluded. Replay does not fall back to real I/O when the trace fails to match. Disabling an effect family makes dependent callables ineligible rather than silently recording an uncontrolled read.

## Values and privacy

V2 adds `undefined`, Date values, byte buffers, and structured errors to bounded plain arrays/objects, primitives, and explicit Value Adapters. Browser adapter modules must be browser-compatible and import their class definitions through the same application graph. The same adapter definitions are loaded in the browser during verification. Node-only adapter code cannot be used for a browser case.

Adapters are trusted synchronous, deterministic, side-effect-free project code; registration does not override effect analysis. Runtime encoding rejects unsupported instances, accessors, cycles, and changed arguments. Node can detect and reject Proxies. Browsers provide no general Proxy detector, so the browser contract requires ordinary data objects and arrays: it cannot guarantee non-interference for arbitrary Proxy inputs.

Limits apply before browser transport and again at ingestion: depth 20, 10,000 value nodes, 256 KiB per observation, and 1,000 pending unique inputs. The browser also bounds its unacknowledged queue. Sensitive keys and recognizable secrets in arguments, read values, metadata, errors, and adapter payloads block persistence and produce a value-free diagnostic. These checks are defense in depth, not a guarantee. Use synthetic development data and inspect every candidate before committing it. There is no telemetry or external upload.

## HMR, interruption, and artifacts

Source changes create new generations. For each extended input, the latest completed generation supplies its candidate; unrelated inputs remain available. An invocation mixing source generations or missing a completion is blocked. Case identity includes the callable, environment, arguments, and trace, and excludes the output, session, generation, and provenance.

Completed envelopes are sealed under `.replaylock/observations/dev-sessions/<session-id>/`. Pending V2 candidates live in `.replaylock/observations/pending-v2/`; reviewed V1 and V2 cases coexist in `.replaylock/cases/`. Keep observations and discovery files ignored by Git. Production builds inject neither recording helpers nor synthetic replay exports.

If the server crashes, stop the owning server process and recover only the completed envelopes:

```sh
replaylock record --recover <session-id>
```

Recovery marks candidate provenance as partial. It does not reconstruct interrupted calls or automatically accept anything, and it refuses sessions whose owning process is still alive or that already have a completion result.

## Verification and diagnostics

V2 verification statically requalifies locators and current source before invoking a target, then uses a fresh process per case. Browser cases additionally run in headless Chromium with the recorded locale and timezone. Install the optional browser dependencies if omitted, then install the browser executable:

```sh
npm install --save-dev @vitest/browser-playwright@4.1.11 playwright@1.63.0
npx playwright install chromium
```

Node-only recording and replay do not need Chromium. On Linux CI, `npx playwright install --with-deps chromium` also installs its system dependencies. Browser replay uses Vite configuration and plugins while removing capture plugins and the project's ordinary test selection/setup.

Exit `0` means success; `1` means behavior changed; `2` means policy, capture, schema, provider, or replay infrastructure failed. Useful additional diagnostics include `EFFECT_TRACE_MISMATCH`, `UNSUPPORTED_EFFECT`, `RUNTIME_PROFILE_MISMATCH`, `BROWSER_PROVIDER_MISSING`, `PENDING_LIMIT`, `INCOMPLETE_OBSERVATION`, and `SESSION_PARTIAL`. The original annotated Vitest workflow (`replaylock()` and `replaylock record -- vitest run`) keeps its V1 behavior.

## Retaining a useful sample

Development capture defaults to 20 distinct cases per callable and realm, with at most two per explicit-input/effect-structure group. Each application invocation still obtains fresh native random/time/read values. Retained cases keep the exact arguments, external-read trace and completion from that invocation.

```js
export default defineReplayLock({
  capture: { retention: { maxPerCallable: 20, maxPerGroup: 2 } },
});
```

Use `retention: false` to disable sampling. Limits are positive integers satisfying `maxPerGroup <= maxPerCallable <= 1000`; omitted fields use the defaults. Existing pending cases consume capacity; reducing limits does not delete them. Groups include canonical explicit arguments and ordered effect operations and call/settlement relationships. External values, effect arguments and the callable completion do not define the group. Admission uses the first distinct full input identities within capacity, so changing only the output cannot rescue an omitted input. Other inputs and callables retain their own capacity. Policy omissions alone do not make capture partial.

Accepted input identities remain eligible for replacement review, even when their group is full. Same-generation conflicting completions still block a candidate; later completed generations preserve the existing selection rule. Global project/transport safety limits continue to apply. A session saves its resolved policy and a bounded admission ledger. Recovery restores sealed observations under that original policy, even if current configuration changed; sessions recorded before retention existed retain their legacy behavior.

Review shows candidates grouped by callable, realm, explicit input and effect structure. Approval still applies to individual cases (or the existing explicit file batch decision); replacements still require confirmation.

## Explaining what happened

```sh
npx replaylock scan --dev --json
npx replaylock report --session <session-id>
npx replaylock report --session <session-id> --json
```

Scan JSON has `schemaVersion: 1` and an `environments` array containing targets, exclusions and the source graph digest. Diagnostics include one-based source positions and bounded call/dependency cause chains. Session reports also have `schemaVersion: 1`; they are stored separately in `report.json` beside the session's sealed observations, with no change to accepted V2 case files.

Rows distinguish eligible/unexercised functions, eligible/observed functions and blocked functions whose execution is unknown because they were never instrumented. Invocation counts precede argument encoding, so a runtime value rejection is visible. Rows include completions, retained cases, duplicates, policy omissions and diagnostic counts. Browser count batches use the same acknowledged sequence protocol as observations; retries do not add counts twice. Active reports are provisional; lost transport, incomplete shutdown and recovery make completeness explicit. `countsComplete` never infers delivered counts merely from saved observations.

Reports project static callable/realm/generation information and aggregate counters. They exclude recorded arguments, effect values and results. Replay failures separately retain the existing `OUTPUT_MISMATCH` / `EFFECT_TRACE_MISMATCH` codes and exits, adding the first differing completion path or trace index/operation and bounded safe expected/actual excerpts. Tolerance decisions and output explanations use the same comparator. Sensitive or unsupported actual values yield a value-free explanation; a caught effect mismatch remains latched.

See [performance and conformance](performance.md) for repeatable maintainer checks and [public pilot evidence](pilots/README.md) for measured application compatibility.
# Middleware HTTP hosts

When Express or another Node HTTP host owns the listener, pass that server through Vite's existing middleware configuration. Mount Vite at its configured base path and let the application own listening and shutdown:

```js
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { replaylock } from 'replaylock/vite';

const http = createHttpServer(app);
const vite = await createViteServer({
  plugins: [replaylock({ dev: true })],
  server: { middlewareMode: { server: http }, hmr: { server: http } },
});
app.use(vite.middlewares);
http.listen(3000, '127.0.0.1');
```

The HMR setting carries browser stop acknowledgements on the same listener and avoids a separate shared WebSocket port. ReplayLock discovers the listener whether it starts before or after Vite. Use the normal `replaylock record -- npm run dev` or `record --attach http://127.0.0.1:3000/` command. Control requests still require the local session token. Closing either Vite or the external listener removes discovery metadata; closing Vite does not close the application's listener. Only plain HTTP listeners reachable over loopback are supported. `middlewareMode: true` alone does not identify an external server.

Development transforms only consider modules with eligible authored callables in the current source analysis. Excluded modules pass through without analyzing generated overlays; eligible modules still revalidate transformed code before instrumentation. Source edits and dependency changes refresh admission. Session-report diagnostic messages contain their diagnostic code; callable names and source positions remain separate structured fields.
