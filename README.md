# ReplayLock

ReplayLock records developer-selected calls that already occur in Vitest, asks a human to review them, and replays the accepted behavior in a fresh process. The result is a **reviewed characterization case** (or regression case), not a generated correctness test.

ReplayLock's static analysis and runtime checks can classify a supported callable as **likely-safe**. That classification is a conservative eligibility judgment, not proof of purity, determinism, or correctness. Keep intentional unit and integration tests for the behavior your application is meant to have.

## Supported V1 environment

V1 is intentionally narrow: Node 22 with Vite and Vitest, directly exported named function declarations or exported const functions/arrows — synchronous or `async`, but never a generator or async generator — and local development or test workloads. Browser, production, customer-data, raw Node-loader, worker, VM-realm, and non-Vitest integrations are outside the V1 compatibility boundary.

Register ReplayLock's Vite plugin in the configuration used by Vitest:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { replaylock } from "replaylock/vite";

export default defineConfig({ plugins: [replaylock()] });
```

## Source directives

Put ReplayLock directives in the JSDoc for a supported exported callable:

```ts
/** @replaylock capture */
export function total(left: number, right: number): number {
  return left + right;
}

/**
 * @replaylock capture
 * @replaylock assume-pure reviewed deterministic wrapper
 */
export const normalizedTotal = (values: number[]) => normalize(values).reduce((a, b) => a + b, 0);

/** @replaylock exclude reads the system clock */
export function currentLabel(): string {
  return new Date().toISOString();
}
```

- `@replaylock capture` selects a callable for recording and verification.
- `@replaylock assume-pure <nonempty reason>` records a human-reviewed assumption for unknown evidence. It cannot override known refuting evidence and becomes stale when its evidence fingerprint changes.
- `@replaylock exclude <nonempty reason>` prevents capture. Effects from an excluded callee still propagate to callers.

Malformed directives and empty reasons fail closed.

## Record, review, verify

ReplayLock has three commands:

```text
replaylock record -- vitest run
replaylock review
replaylock verify
```

`record` first scans project source and applies the same directive, call-graph, and assumption-fingerprint analysis used by Vite instrumentation. It does not launch the wrapped command when there is no capture target, every requested target is blocked, project/session setup fails, or adapter configuration is invalid. With at least one eligible target, it runs the command after `--` and observes eligible calls naturally; ReplayLock never calls a target merely to manufacture an observation. Blocked targets make requested coverage partial while independent eligible targets still run and can produce safe candidates. A successful plugin handshake with no invocation is a valid zero-candidate recording, but a missing handshake fails with `PLUGIN_NOT_ACTIVE`.

`review` displays each pending candidate's callable, arguments, return or throw completion, eligibility evidence, provenance, and occurrence count. Accept, reject, or skip each candidate explicitly. Acceptance writes a deterministic case; later behavior is an explicit old/new replacement decision, never an automatic expected-value update.

`verify` parses and preflights the complete accepted set before any target runs, then invokes each target in a disposable fresh Vitest process and compares the exact canonical completion. A return/throw change, error change, or structural value change is a regression. Verification does not generate one source test per case.

## Scan

```text
replaylock scan
```

`scan` reports capture eligibility for every directly exported function across the project, whether or not it already carries a `@replaylock` directive, using the same source-policy and call-graph analysis `record`'s preflight runs. It launches no Vitest process, requires no Vite configuration, writes nothing under `.replaylock/`, and always exits `0`: it is a report, not a gate. Each line names the export's status — `SCAN_ELIGIBLE`, `SCAN_NEEDS_REVIEW` (unknown effects, no retained assumption), `SCAN_INELIGIBLE` (refuted, with the leading reason code), `SCAN_UNSUPPORTED_SHAPE`, or `SCAN_EXCLUDED` — followed by a project-wide summary count. Use it before wiring the Vite plugin into Vitest at all, to see how much of a codebase is worth annotating.

## Artifacts and privacy

Pending candidates live under `.replaylock/observations/pending/`; blocked reports and session data remain under `.replaylock/observations/`. They are ignored by Git, written with owner-only permissions where supported, and may be incomplete after interrupted recording. Accepted cases are deterministic, versioned JSON under `.replaylock/cases/*.json`; they contain the locator, canonical arguments and completion, exact comparison contract, eligibility evidence, source and lockfile provenance, and runtime profile, but not timestamps, commands, environment variables, worker IDs, or occurrence counts. Verification and adapter-validation scratch data under `.replaylock/verify/`, `.replaylock/validate/`, and `.replaylock/catalog/` is ephemeral and ignored.

Record **only development or test workloads** with synthetic or otherwise non-sensitive values. Privacy checks are defense in depth, not a guarantee. A human must inspect every displayed argument, completion, adapter payload, and accepted artifact before committing it. Never record production or customer data. ReplayLock does not upload source, captured values, cases, or pilot metrics and introduces no telemetry.

## Exit codes

- `0`: the requested ReplayLock operation succeeded. Observation-scoped blocks can coexist with a clean successful recording when requested coverage remains complete.
- `1`: one or more accepted cases failed behavioral verification, including an output/completion mismatch or an actual completion that cannot be safely adapted.
- `2`: usage, policy, analysis, instrumentation, schema, storage, configuration, or replay infrastructure failed. Partial requested coverage also fails with `2` when the wrapped command otherwise succeeds.

For `record`, a nonzero wrapped-command status remains the process status; ReplayLock diagnostics are still reported. ReplayLock uses `2` only when the wrapped command itself succeeded.

## Stable diagnostics

Stable uppercase diagnostic codes are the machine-routable part of terminal reporting; explanatory wording may evolve. When ReplayLock has a more specific implementation reason, it reports the public code first and retains the granular reason after it (for example, `REPLAY_SAFETY_REGRESSION EFFECT_REFUTED`). CI should route on the first code and may display the reason for diagnosis.

- Source and eligibility: `NO_CAPTURE_TARGET`, `NO_ELIGIBLE_TARGET`, `PROJECT_ANALYSIS_FAILED`, `INVALID_POLICY`, `UNSUPPORTED_CALLABLE`, `UNKNOWN_EFFECT`, `KNOWN_EFFECT` (record preflight), `EFFECT_REFUTED` (accepted-case verification), `ASSERTION_CONFLICT`, `STALE_ASSERTION`, `CAPTURE_POLICY_CHANGED`, `MISSING_ASSUMPTION`.
- Activation and sessions: `SESSION_SETUP_FAILED`, `PLUGIN_NOT_ACTIVE`, `SESSION_PARTIAL`, `INCOMPLETE_OBSERVATION`.
- Observation safety: `MUTATED_INPUT`, `SENSITIVE_VALUE`, `UNSUPPORTED_VALUE`, `OVERSIZED_OBSERVATION`, `PENDING_LIMIT`, `PROJECT_LIMIT`, `OBSERVED_NONDETERMINISM`.
- Accepted-case replay: `CASE_SCHEMA_UNSUPPORTED`, `ORPHANED_CALLABLE`, `COMPLETION_KIND_MISMATCH`, `OUTPUT_MISMATCH`.
- Public replay and storage routing: `REPLAY_SAFETY_REGRESSION` identifies an accepted case that is no longer safe to invoke and retains reasons such as `CAPTURE_POLICY_CHANGED`, `UNSUPPORTED_CALLABLE`, `EFFECT_REFUTED`, `MISSING_ASSUMPTION`, or `STALE_ASSERTION`; `STORE_WRITE_FAILED` identifies an atomic pending-session or accepted-case write that could not be completed and retains the failed write stage.
- Public Value Adapter routing: `VALUE_ADAPTER_INVALID`, `VALUE_ADAPTER_ID_CONFLICT`, `VALUE_ADAPTER_PROTOTYPE_CONFLICT`, `VALUE_ADAPTER_SERIALIZE_FAILED`, `VALUE_ADAPTER_PAYLOAD_UNSUPPORTED`, `VALUE_ADAPTER_MISSING`, `VALUE_ADAPTER_DESERIALIZE_FAILED`, `VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH`, `VALUE_ADAPTER_VERSION_MISMATCH`, `VALUE_ADAPTER_VALIDATION_TIMEOUT`, and `VALUE_ADAPTER_ROUNDTRIP_MISMATCH`.
- Public Trusted Package routing: `TRUSTED_PACKAGE_INVALID` retains `TRUSTED_PACKAGE_CONFIG_LOAD_FAILED` or `TRUSTED_PACKAGE_REGISTRY_FAILED`, and a registry failure retains the granular cause: `TRUSTED_PACKAGE_DEFINITION_INVALID`, `TRUSTED_PACKAGE_ID_DUPLICATE`, or `TRUSTED_PACKAGE_VERSION_RANGE_INVALID`. `TRUSTED_PACKAGE_CALL` is the evidence code a catalogued call contributes; it is never an error.

Adapter diagnostics likewise retain the existing granular cause. For example, invalid definitions may retain `VALUE_ADAPTER_DEFINITION_INVALID`, `VALUE_ADAPTER_ID_INVALID`, `VALUE_ADAPTER_VERSION_INVALID`, `VALUE_ADAPTER_TOKEN_INVALID`, or `VALUE_ADAPTER_BUILTIN_PROTOTYPE`; conflicts retain `VALUE_ADAPTER_ID_DUPLICATE` or `VALUE_ADAPTER_PROTOTYPE_DUPLICATE`; and reconstruction type failures retain `VALUE_ADAPTER_PROTOTYPE_MISMATCH`. A serializer payload outside the built-in canonical model reports `VALUE_ADAPTER_PAYLOAD_UNSUPPORTED`; an unadapted runtime class remains the ordinary `UNSUPPORTED_VALUE`. A persisted adapted node distinguishes an absent registered ID (`VALUE_ADAPTER_MISSING`) from the same ID at the wrong version (`VALUE_ADAPTER_VERSION_MISMATCH`).

`INSTRUMENTATION_UNSUPPORTED` is reserved for a future environment in which the requested integration is recognized but cannot be instrumented. No current V1 path emits it: unsupported target shapes use `UNSUPPORTED_CALLABLE`, and a missing Vite handshake uses `PLUGIN_NOT_ACTIVE`.

Diagnostics never intentionally include blocked captured content. See [Troubleshooting](docs/troubleshooting.md) for recovery steps, [Value Adapters](docs/value-adapters.md) for domain classes, and [Trusted Packages](docs/trusted-packages.md) for the package trust catalog.

## Project configuration

Projects needing class or domain values can add `replaylock.config.ts` (also `.mts`, `.js`, `.mjs`, `.cts`, or `.cjs`):

```ts
import { defineReplayLock } from "replaylock";
import { moneyAdapter } from "./src/money.replaylock.js";

export default defineReplayLock({ valueAdapters: [moneyAdapter] });
```

Adapter modules are development-only trust boundaries and must load through the recording module graph without initialization effects. Registration changes encodability only; it never overrides purity or effect evidence.

## Trusted packages

A call into a package import (`import { get } from "lodash"`) contributes unknown `PACKAGE_CALL` evidence by default; ReplayLock ships no built-in opinion about which npm packages are pure. A project can declare a trusted-package catalog naming specific package exports it vouches for, each bound to a semver range checked against the version resolved from the project's lockfile:

```ts
import { defineReplayLock } from "replaylock";

export default defineReplayLock({
  trustedPackages: [
    { package: "lodash", exports: [{ export: "get", versions: "^4.17.0" }] },
  ],
});
```

A catalogued match contributes `TRUSTED_PACKAGE_CALL` evidence, visible in `review` output and persisted in the accepted case, instead of falling through to unknown evidence. A version bump outside the declared range, or removal of the catalog entry, reverts the call to unknown and fails `verify` closed. See [Trusted Packages](docs/trusted-packages.md) for the full scope, the `unpinned` escape hatch, and the current npm-only version-resolution limitation.

Before broader adoption, use the telemetry-free [manual pilot checklist](docs/pilot-checklist.md). Record measures locally, discuss false-safe findings explicitly, and expand scope only from observed blockers.
