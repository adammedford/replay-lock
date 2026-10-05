# #127: independent ordinary-replay recipe source audit

Status: source-backed feasibility findings at `ee6d44053acd01223da9075fd88e473a143e5c27`, not an implemented recipe or runtime proof. The incomplete pinned application was not inspected, reconstructed or executed. This audit does not change qualification, effect policy, artifact schema, public APIs or the accepted operation-boundary timing contract. Full G1B remains unmet.

## Finding

The ordinary verifier supplies controllable Node evaluator and browser transform-return attachment points, but those points do not supply an independent qualified reference. Replay instrumentation depends on a project analysis assembled from disk, not merely the entry closure returned by the generation owner. Node live, Node replay and browser delivery also have different final representations. A recipe that hashes the actual transform result and immediately compares that result to its own hash proves nothing about the trusted transformation. [S1–S7]

## Primary sources and inspected dependency identity

Repository citations refer to the retained baseline above; line ranges are one-based:

- S1: [ordinary verification](../../src/dev-verify.ts), lines 79–101 (preflight), 198–258 (worker, aliases, replay transform), 259–268 (environment transform), 318–332 (configuration and Browser Mode project), 340–348 (plugin filtering), 350–406 (generated harness and target import).
- S2: [instrumentation](../../src/dev-transform.ts), lines 11–65 (project-cache and overlay entrypoints), 68–83 (eligible target selection), 126–133 (metadata), 167–196 (runtime import, replay exports and map).
- S3: [analysis input construction](../../src/dev-analysis.ts), lines 123–270 (filesystem walk, metadata, one-file overlay, resolution and compiler host), 1154–1170 (digest and returned currentness).
- S4: [input tracking](../../src/dev-project-cache.ts), lines 10–56 (stat probes, cached reads, failed probes and currentness); [analysis worker](../../src/dev-analysis-worker.ts), lines 12–27; [analysis client](../../src/dev-analysis-client.ts), lines 22–67.
- S5: [retained generation owner](../../scripts/prototype-import-generation.mjs), lines 64–105; [fixture configuration](../../scripts/prototype-import-workflow.mjs), lines 130–136.
- S6: [replay attachments](../../scripts/prototype-import-evaluator-attachment.mjs), lines 20–69; [shared client attachment](../../scripts/prototype-import-attachment-controls.mjs), lines 6–24.
- S7: installed Vite `node_modules/vite/dist/node/chunks/node.js`, lines 34296–34364 (`fetchModule`, map decoration, hashbang), 25193–25215 (browser middleware transform and send), 19688–19716 (`send`, 304 and map decoration).
- S8: installed Vitest `node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js`, lines 1123–1137 (cached reply and fetch), 1174–1207 (processed source and map decoration), 1209–1216 (cache reply).
- S9: installed Vitest `node_modules/vitest/dist/module-evaluator.js`, lines 70–82 (native external import), 106–108 (inline entrypoint), 164–206 (metadata, wrapper and VM compilation).

Inspected package metadata: Vite `8.2.2`, Vitest `4.1.11`, `@vitest/browser` `4.1.11`. Independently measured installed file SHA-256 values:

| Source | SHA-256 |
| --- | --- |
| Vite `dist/node/chunks/node.js` | `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0` |
| Vitest `dist/chunks/cli-api.CnMVyzaz.js` | `a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e` |
| Vitest `dist/module-evaluator.js` | `a0b36fb2211d2587d8df68d5855d48141be27e99bdb973378a83f927e03b004e` |

These identify this inspection, not a complete transitive trusted-tool inventory, atomic snapshot guarantee or runtime qualification.

## Analysis is not yet a snapshot-only function

`buildDevProject` walks non-hidden/non-ignored project directories, records source files and package/config/lock/environment metadata, then replaces only one source with a supplied overlay. Selected roots need not be limited to the application entry closure. Relative, alias, subpath and package resolutions can read additional metadata and sources. Its compiler host uses the input tracker for file probes and reads. The source digest includes all collected source/metadata plus resolved options and realm. Consequently unrelated discovered text can change emitted observation metadata even if the retained entry/helper strings are unchanged. [S2, S3]

The cache validates stat-based currentness before rebuilding, and the input tracker caches text. That is not an atomic whole-filesystem snapshot or an immutable externally supplied input manifest. Passing retained text for one module does not prevent other analysis inputs coming from ambient disk. The live worker boundary does not repair this: requests carry options and an optional single transform input; the worker constructs the same cache from its root. Ordinary replay calls that cache directly. [S2–S4]

The fixture generation owner retains its recursively qualified entry closure plus four fixed metadata/controller files, but it does not expose or substitute the analysis tracker's complete reads and failed-resolution probes. That mismatch must be resolved before the owner snapshot can serve as the sole independent recipe input. [S3–S5]

## Replay has an explicit trusted infrastructure frontier

Replay uses generation `"verify"`, `replay: true` and runtime import `"replaylock/dev/runtime"`. Instrumentation embeds source-graph digest, locator, generation and realm, then adds synthetic replay exports. A separate trusted transform tracks `import.meta.env`. Runtime/values/diff/Vitest aliases, environment tracker, generated test harness, and any explicitly allowed adapter configuration are not qualified application modules. They must remain a finite identified infrastructure prerequisite, not a general package or application-effect exception. [S1, S2]

The normal verifier loads project Vite configuration and retains plugins other than the two named recording plugins. This is not a safe way to discover an arbitrary project's trusted recipe: configuration loading and plugins can execute code. In this evaluation the generated fixture configuration has a fixed gate and optional private replay-delivery attachment. A candidate must pin that exact construction and resolved ordering rather than silently admit whatever the ordinary merge discovers. No arbitrary configuration/plugin execution was performed in this audit. [S1, S5, S6]

## Comparison boundaries are realm-specific

| Boundary | Observed representation | Remaining obligation |
| --- | --- | --- |
| Ordinary Node replay `runInlinedModule` | Vitest receives processed SSR code, with its own inline-map handling; the evaluator subsequently adds its strict async VM wrapper. | Build the matching reference from qualified inputs, pin the wrapper/identity contract, and classify native/cache bypasses. |
| Live Node `fetchModule` | Vite can append `sourceURL` plus its map marker and inline map, then blank a hashbang. | Do not reuse the Vitest reference string as the live string. |
| Browser `client.transformRequest` return | Code and map before HTTP `send` decoration. | Bind the map and deterministic decoration as well as code, and account for 304/cache responses and module reuse. |

Vitest explicitly calls Vite fetch with `inlineSourceMap: false`; it then uses the module-graph transform result when available, inlines its map with a possible first-line mapping adjustment, and does not append Vite's `sourceURL`. Its VM evaluator wraps this result with an async function and CJS/import metadata parameters. These are real differences, not permission to normalize arbitrary mismatches away. [S7–S9]

The retained browser attachment wraps the actual client transform return. Browser middleware subsequently passes code and map to `send`, which can append a supplied or fallback source map or return 304. Thus the attachment controls code before delivery, but it is not by itself a final wire-byte owner. If the next experiment chooses a `(code, map, identity, delivery recipe)` boundary, it must say so explicitly; claiming exact final response bytes from code equality alone would overstate the result. [S6, S7]

## Independent-reference candidate, not established behavior

A defensible candidate starts from an immutable, explicitly enumerated qualified input set: source closure, the complete analysis input/probe manifest, resolved options, physical identities and realm-specific path/URL/generation inputs. A fixed trusted chain then produces reference code/maps without executing application modules. The ordinary host's downstream code/maps are compared against that independently prepared reference before any application entry execution or delivery. The reference chain may reuse trusted transformation algorithms, but must not consume the actual output it is validating or ask the same mutable host cache to define both sides.

This assumes a finite trustworthy transform inventory, correct algorithm behavior, independent input ownership and a coherent snapshot. None of those assumptions follows solely from package version pins or equal hashes. A new private snapshot-only analysis input path may be required; the current APIs do not provide it. A separate Vite instance using the same ambient filesystem and discovered plugins is not automatically independent.

Whole-closure admission is essential: comparing the helper only after the entry has started evaluating is too late to establish refusal before initialization. Prepare and bind every application module and its allowed edges before releasing entry execution/delivery, while preserving ordinary host semantics. Unknown additional entries, external/native routes, cache replies without bound representations and reused module namespaces still require explicit denial or qualification. S8 demonstrates replies that avoid fresh transformation; S9 demonstrates native imports outside the inline evaluator. Whether each cache path reaches a checked evaluator remains a separate runtime obligation; this audit does not claim these routes are controlled.

## Next refutable public slice

First resolve the immutable analysis-input/recipe contract, then add a bounded synthetic whole-closure preparation experiment at the existing private fixture-host seams. Keep the actual HTTP/button invocation, complete pending-observation inspection, explicit review and ordinary offline verifier. Do not replace either host with a standalone passing evaluator.

The executable acceptance target is: unchanged entry/helper closure yields result 7 and ordinary verify succeeds; the established harmless downstream helper mutation is refused before application entry starts, produces no pending observation and is not accepted; replay refuses as infrastructure/qualification failure rather than ordinary output mismatch after execution. Retain the mutation-positive control that evaluates 8 without a comparator so an unattached refusal implementation cannot appear green. Cover both realms and both hosts before extending warm/cached/native routes. The 60000ms per-test ceilings and admitted-old-turn timing remain unchanged.

This is a sequence proposal, not executed evidence or permission to add a public loader/schema seam. Before claiming exact-byte binding, settle the browser final-decoration boundary and complete trusted runtime/transform identities. Before G1B, additionally prove coherent capture, lifecycle/cache ownership, unsupported routes, native-effect oracles, caps and provenance/artifact currentness. No runtime tests or application imports were run for this source-only audit.
