# Constrained import seam: feasibility and decision input

Status: **research/specification only**, 2026-10-02. The user approved investigation after #126, not a loader, sandbox, prototype or production policy. Parent decision [#123](https://github.com/adammedford/replay-lock/issues/123); unfinished application proof [#106](https://github.com/adammedford/replay-lock/issues/106). Read this with the [platform audit](constrained-import-platform-research.md) and [proposed acceptance spec](constrained-import-evaluation.md).

## Findings and recommendation

A constrained import seam can plausibly **refuse an entire unsupported graph before it starts evaluating**, then execute admitted source using the ordinary host. This is a proposed execution contract, not established runtime safety. It is not a way to execute arbitrary effectful initialization while claiming those effects never happen. Removing or replacing a global write, getter, logging call or registration can change exports, closure state, errors and timing; isolation does not prove equivalence.

Recommend evaluating an all-or-nothing graph-admission module first, with separate live/replay host adapters and no new effect permission. Its leverage would be prevention, not increased eligibility. If the complete graph, evaluated bytes, resolution and caches cannot be bound before evaluation in **both** realms, report infeasibility and retain ineligibility. Do not substitute a replay-only success or relaxed policy. This recommendation requires approval of the accompanying spec before implementation.

## Repository audit at 0867957

All source links below pin `0867957626ba7a0869fe1fa2753ec311afee60d0`, the merged main revision inspected during this investigation. Node22.19.0, Vite8.2.2 and Vitest4.1.11 are the declared package contract; no dependencies were installed for this documentation work.

| Current path | Source-derived behavior | Consequence for the proposed seam |
| --- | --- | --- |
| [Live transform](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-server.ts#L345-L364) | Ineligible authored transforms return null; dependency modules are not instrumented here | Refusal to record is not refusal to evaluate. The normal development application can still execute unsupported code. |
| [Runtime capture](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-runtime.ts#L154-L175), [effect handling](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-runtime.ts#L302-L310) | Unsupported capture is left unobserved; missing/blocked capture frames can invoke ordinary behavior | These are observation rules, not pre-native-execution enforcement. Changing them silently would change the existing development contract. |
| [Replay preflight](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-verify.ts#L79-L103) | Requalifies current callable and physical locator before importing it | Reuse its current-source obligation, but callable eligibility alone does not certify every initializer in an executed graph. |
| [Replay import and invocation](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-verify.ts#L374-L401) | Imports the target before entering its invocation trace context | Invocation-time replay does not automatically intercept module initialization. |
| [Replay transforms](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-verify.ts#L214-L267) | Instruments selected authored modules; dependencies/configuration are outside that transform selection | An authored-source plugin check cannot alone control externalized dependency evaluation or generated source. |
| [Configuration lifecycle](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-options.ts#L96-L122), [verification configuration](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-verify.ts#L317-L337) | Existing workflows load project configuration and plugins | A future experiment must explicitly restrict trusted fixture infrastructure. It cannot claim to prevent effects that occurred while loading an application config before its gate existed. |
| [Graph propagation](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-analysis.ts#L1093-L1134), [cache input tracker](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/src/dev-project-cache.ts) | Distinguishes global/module/binding taint and fingerprints current inputs | A new whole-graph execution proof must include declaration-local initialization, not ignore effects simply because an export is unused. Existing cache correctness is useful but does not bind a later plugin's output by itself. |

The analyzer also fingerprints dotenv metadata during ordinary configured discovery. This investigation did **not** run that discovery against Epic: it read selected source and Git state only. Future read-only comparisons must continue excluding dotenv reads and config execution explicitly; they are narrower than fully configured qualification.

## Platform implications

Node22.19 loader hooks operate on resolution/loading, not arbitrary property reads or native calls; they must be established before relevant imports. Vite8.2.2 has distinct inlined and external execution routes, and cache/shortcut routes that cannot be covered by a transform-only check. These findings were independently cross-checked in versioned documentation and installed/tagged source. [Node release documentation](https://nodejs.org/download/release/v22.19.0/docs/api/module.html#customization-hooks), [Vite evaluator](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/module-runner/esmEvaluator.ts), [Vite runner](https://github.com/vitejs/vite/blob/v8.2.2/packages/vite/src/module-runner/runner.ts).

Browser module fetching/linking is separate from evaluation, with module-map reuse. Holding a controlled entry until its entire graph is qualified is a candidate placement, not a browser-wide JavaScript interception API. Per-file refusal can be too late to prevent a safe sibling from evaluating. Query-based cache busting can also change module identity; use fresh realms across invalidated generations rather than inventing module identities. [HTML execution and module maps](https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script), [Node URL identity](https://nodejs.org/download/release/v22.19.0/docs/api/esm.html#urls).

The Node permission model and VM do not establish hostile-code safety. They cannot supply a missing live/browser equivalence proof. The first evaluation should use a closed effect-free source grammar, not execute unknown code under permission flags to discover its behavior. [Node permissions](https://nodejs.org/download/release/v22.19.0/docs/api/permissions.html#permission-model), [Node VM](https://nodejs.org/download/release/v22.19.0/docs/api/vm.html#vm-executing-javascript).

## Application value remains unestablished

Pinned Epic remains `8473afd804b66dba6a23f317908dc35d1535e90d`; existing pilot edits were preserved. Selected source reread confirms:

- Noble's initializer has empty-array appends, destructuring, nested flow, ambient BigInt conversion and imported splitting—not the closed numeric grammar evaluated by #126.
- Prism writes a global registration and has browser listener/scheduling paths. Suppressing these changes initialization behavior.
- Sentry's conditional iframe/global replacement and catch logging depend on mutable host behavior; a loader does not prove that branch unreachable.
- OAuth registration depends on environment reads and can log or construct a strategy. Synthetic replay placeholders do not prove live safety.

The earlier [pinned blocker map](https://github.com/adammedford/replay-lock/blob/0867957626ba7a0869fe1fa2753ec311afee60d0/docs/pilots/analyzer-precision-2026-10-01.md) and retained [#126 evaluation](https://github.com/adammedford/replay-lock/blob/8d5bcc7bbba7f489f2f08dc2d6edd84a8c0d756f/docs/plans/owned-initialization-prototype.md) remain the evidence for zero named gain. No new Epic scan, target import, capture, replay, mutation result or human timing was performed here.

## Decision threshold

The accompanying spec asks whether prevention can be demonstrated while preserving an admitted finite graph's original initialization, exports and identity. Success would justify only that narrower execution contract. It would **not** prove constrained execution of actual effectful dependencies, production support, or completion of #106. Failure to establish either realm's enforcement point, full graph/source binding or independent native-effect oracle is an explicit failure or host limitation—not permission to shrink the claim unnoticed. #107 remains blocked; initial60000ms human ceiling and later checkpoints are unchanged.
