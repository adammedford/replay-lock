# Value Adapters

A Value Adapter lets ReplayLock encode a class or domain value without teaching the domain class about ReplayLock. It is a developer trust contract, not reflection, generic JSON conversion, a purity override, or proof that omitted state is irrelevant.

## Define and register an adapter

```ts
// src/money.replaylock.ts — development/test-only module
import { defineValueAdapter } from "replaylock";
import { Money } from "./money.js";

export const moneyAdapter = defineValueAdapter({
  type: Money,
  id: "example.money",
  version: 1,
  serialize(value: Money) {
    return { cents: value.cents };
  },
  deserialize(payload: unknown) {
    if (typeof payload !== "object" || payload === null ||
        typeof (payload as { cents?: unknown }).cents !== "number") {
      throw new TypeError("invalid Money payload");
    }
    return Money.fromCents((payload as { cents: number }).cents);
  },
});
```

Register it from `replaylock.config.ts` with `defineReplayLock({ valueAdapters: [moneyAdapter] })`.

Use a stable namespaced `id` describing the wire identity rather than a constructor or file name. `version` is a positive integer for that payload contract. ReplayLock matches the registered class token by exact worker-local prototype: subclasses, proxies, cross-realm copies, and lookalike prototypes do not match.

The serialized payload may contain only ReplayLock's built-in canonical values. It cannot contain another adapted value, a cycle, or a repeated alias that would change identity topology. Ordinary size, graph, unsupported-value, and secret checks apply. Review shows the adapter ID, version, and canonical payload rather than constructor internals.

## Trust contract

Both `serialize` and `deserialize` must be:

- **synchronous** — no promises, delayed work, or async dependencies;
- **deterministic** — the same complete state and payload always produce the same result;
- **side-effect-free** — no I/O, application mutation, logging, clocks, randomness, or ambient-state changes; and
- **complete for callable-observable state** — the canonical payload contains every part of the value that the recorded callable can observe.

ReplayLock cannot prove or sandbox these properties. A violating serializer runs at the observation boundary; ReplayLock can catch a thrown error and stop later capture callbacks, but cannot undo mutation, I/O, disclosure, or other effects the adapter already caused. A violating deserializer or incomplete payload can alter reconstructed behavior. Nondeterminism can create unstable identities, round-trip failures, or false regressions. Omitted state can create a false-safe characterization case that passes while meaningful behavior was lost.

ReplayLock validates every retained adapted entry and completion in an isolated post-recording process. Validation deserializes a fresh payload, requires the exact registered prototype, then reserializes and requires byte-identical canonical payload. Before verification invokes any target, every adapted argument and expected completion must resolve and pass the same checks. These checks validate conformance; they do not prove the trust contract.

## Evolution workflow

Constructor changes, private-field refactors, and class/file moves can keep verifying when the stable payload meaning, adapter ID, version, and exact loaded class token remain compatible.

For an incompatible wire change:

1. Increment the adapter `version`.
2. Re-record the naturally occurring call.
3. Review and accept the new candidate in a normal source-control change.
4. Verify the new accepted set.
5. Explicitly delete the obsolete argument-version case and verify again.

Argument adapter versions participate in case identity, so old and new cases can coexist during review. A completion-only version change is an explicit replacement. ReplayLock does not migrate payloads, fall back across versions, or silently retire artifacts. A missing or incompatible adapter fails verification before business behavior runs.

Keep adapters beside their domain types in dedicated development-only modules, register them centrally, and avoid initialization effects, mocks, or duplicate class module instances during recording.
