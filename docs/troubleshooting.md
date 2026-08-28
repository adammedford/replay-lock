# Troubleshooting ReplayLock V1

Start with the first stable uppercase diagnostic code. Captured values are absent from blocked diagnostics, so inspect source, configuration, pending state, and accepted artifacts locally. A following uppercase token is retained granular detail, not a different public routing category; for example, route `REPLAY_SAFETY_REGRESSION EFFECT_REFUTED` as `REPLAY_SAFETY_REGRESSION` and use `EFFECT_REFUTED` to choose the repair.

## Blocked evidence

`NO_CAPTURE_TARGET` and `NO_ELIGIBLE_TARGET` are pre-execution failures: the wrapped command was not launched. Add a valid `@replaylock capture` target or resolve the diagnostics blocking every requested target. `PROJECT_ANALYSIS_FAILED`, `SESSION_SETUP_FAILED`, and adapter configuration diagnostics likewise stop before business execution; correct project readability, the single supported lockfile requirement, artifact permissions, or the adapter registry before retrying.

`KNOWN_EFFECT` during record preflight, or `EFFECT_REFUTED` while verifying an accepted case, means reachable code has known I/O, time, randomness, ambient-state, mutation, or initialization evidence. Do not add an assumption to override it. Isolate the effect behind an explicit input, keep the target out of capture, or use `@replaylock exclude <reason>` and retain intentional tests.

`UNKNOWN_EFFECT` means analysis cannot justify likely safety. After reviewing the complete evidence, a human may add `@replaylock assume-pure <nonempty reason>` and re-record. `ASSERTION_CONFLICT` means known evidence refutes that assumption. `INVALID_POLICY` or `UNSUPPORTED_CALLABLE` requires correcting the directive or using a directly exported named function declaration or const function/arrow, synchronous or `async` (never a generator or async generator).

An `async` callable is analyzed exactly like a synchronous one: `await` is transparent to the analyzer, so an awaited effect is attributed to its real source position the same way a synchronous call is. Common async patterns that construct or resolve through the built-in `Promise` — `new Promise((resolve, reject) => { ... })`, `Promise.all(...)`, `Promise.resolve(...)` — are not in the analyzer's deterministic-intrinsic catalog, so they contribute `UNKNOWN_CALL` evidence like any other unrecognized global rather than a special "async" diagnostic. Treat them the same as `UNKNOWN_EFFECT`: review the complete evidence and add an explicit `@replaylock assume-pure <nonempty reason>` if still justified, or restructure the callable to avoid them.

## Partial sessions

`SESSION_PARTIAL` or `INCOMPLETE_OBSERVATION` means a worker did not close cleanly, a chunk was malformed, or storage failed. Safe completed calls remain reviewable with partial provenance; incomplete calls never become candidates. Inspect the wrapped command and `.replaylock/observations/`, fix the failure, then record again. Partial requested coverage exits `2` when the wrapped command otherwise succeeds; if the wrapped command fails, its status remains primary.

Observation-scoped blocks such as `SENSITIVE_VALUE`, `MUTATED_INPUT`, `UNSUPPORTED_VALUE`, `OVERSIZED_OBSERVATION`, or `OBSERVED_NONDETERMINISM` retain independent safe candidates. Refactor the boundary, use synthetic values, or add a conforming Value Adapter; do not hand-edit pending data.

## Plugin activation

`PLUGIN_NOT_ACTIVE` means `record` never received the ReplayLock Vite plugin handshake. Confirm that the command after `--` uses Vitest, the loaded config imports `replaylock` from `replaylock/vite`, and `plugins: [replaylock()]` is present. Check monorepo working directories and alternate config flags. A valid handshake with eligible targets but zero invocations is not an activation failure.

## Stale assumptions

`STALE_ASSERTION` means local module bytes, the project lockfile, unknown evidence set, analyzer/catalog inputs, or the assumption fingerprint changed; even formatting can stale a manual assertion. ReplayLock will not reuse old approval. Review the complete current evidence and reason, then re-record and explicitly reapprove it if still justified. Never copy fingerprints or edit JSON to bypass freshness.

`MISSING_ASSUMPTION` means a manually justified accepted case no longer has its source assumption. Restore and review a valid assumption or retire the case.

## Orphaned callables and policy changes

`ORPHANED_CALLABLE` means the exact module/export locator no longer resolves, including renamed or moved targets and path/casing changes. ReplayLock never guesses identity. Capture the new stable export, naturally re-record and review it, then explicitly delete the old accepted artifact in the same source-control change.

`CAPTURE_POLICY_CHANGED` means capture was removed, excluded, or invalidated. Restore the intended reviewed policy or explicitly retire the case. `CASE_SCHEMA_UNSUPPORTED` means an artifact is malformed or from an unsupported future schema; restore a valid reviewed artifact rather than editing through the failure.

During verification, safety failures are reported public-code first as `REPLAY_SAFETY_REGRESSION`, with `CAPTURE_POLICY_CHANGED`, `UNSUPPORTED_CALLABLE`, `EFFECT_REFUTED`, `MISSING_ASSUMPTION`, or `STALE_ASSERTION` retained as the granular reason. This category always blocks the affected accepted target before invocation. Do not route these failures as output regressions merely because the previously accepted completion might still match.

## Storage failures

`STORE_WRITE_FAILED` means ReplayLock could not atomically complete a pending-session or accepted-case write. The retained stage or storage reason identifies which write failed. Preserve the last known-good artifacts, correct permissions, available space, or filesystem support, and retry the ReplayLock operation; do not reconstruct or hand-edit a partially written artifact. A storage failure is infrastructure failure with exit `2` when no wrapped-command failure takes precedence.

## Adapter configuration and evolution

Adapter reporting uses these public codes first while retaining the granular implementation cause:

- `VALUE_ADAPTER_INVALID`: the definition, ID syntax, declared version, class token, built-in prototype target, configuration load, registry, or validator setup is invalid. Existing detail such as `VALUE_ADAPTER_DEFINITION_INVALID`, `VALUE_ADAPTER_ID_INVALID`, `VALUE_ADAPTER_VERSION_INVALID`, `VALUE_ADAPTER_TOKEN_INVALID`, `VALUE_ADAPTER_BUILTIN_PROTOTYPE`, `VALUE_ADAPTER_CONFIG_LOAD_FAILED`, `VALUE_ADAPTER_REGISTRY_FAILED`, or `VALUE_ADAPTER_VALIDATOR_FAILED` identifies the failed check.
- `VALUE_ADAPTER_ID_CONFLICT` and `VALUE_ADAPTER_PROTOTYPE_CONFLICT`: two registrations claim one stable ID or one exact prototype; the retained details are `VALUE_ADAPTER_ID_DUPLICATE` and `VALUE_ADAPTER_PROTOTYPE_DUPLICATE`.
- `VALUE_ADAPTER_SERIALIZE_FAILED`: the trusted serializer threw or otherwise failed while projecting a natural value.
- `VALUE_ADAPTER_PAYLOAD_UNSUPPORTED`: serialization returned a payload outside ReplayLock's built-in canonical value model. The granular cause may identify an unsupported shape or resource limit. Secret-like adapter payloads remain `SENSITIVE_VALUE` and are never persisted.
- `VALUE_ADAPTER_MISSING`: a persisted adapted node names an adapter ID that is not registered. This is distinct from an unadapted class observed at runtime, which reports `UNSUPPORTED_VALUE`.
- `VALUE_ADAPTER_VERSION_MISMATCH`: the stable ID is registered, but its configured version differs from the persisted node.
- `VALUE_ADAPTER_DESERIALIZE_FAILED`: deserialization rejected or threw for the unknown persisted payload.
- `VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH`: deserialization returned the wrong exact prototype, retaining `VALUE_ADAPTER_PROTOTYPE_MISMATCH` as detail.
- `VALUE_ADAPTER_VALIDATION_TIMEOUT` and `VALUE_ADAPTER_ROUNDTRIP_MISMATCH`: isolated validation did not finish in time or byte-identical canonical reserialization failed.

Invalid or conflicting adapter setup stops before business execution with exit `2`. Fix `replaylock.config.*` and keep adapter definitions as plain synchronous data properties.

Lookup, deserialization, prototype, timeout, validator, and round-trip failures stop verification before target invocation. Confirm stable ID/version, load the exact class module, validate unknown payloads, return a fresh exact-prototype value, and ensure byte-identical canonical reserialization. Serializer failures during recording block only that observation when the remaining session is clean; an actual-completion serialization failure during verification exits `1`.

For an incompatible wire change, increment the version and follow the [accept-new, verify, delete-old workflow](value-adapters.md#evolution-workflow). Do not silently reinterpret an old payload, add fallback, or edit the artifact. Completion-only changes appear as a replacement; argument changes create a new case identity.

## Mismatches

`COMPLETION_KIND_MISMATCH` means return changed to throw or throw changed to return. `OUTPUT_MISMATCH` means the exact canonical return, error name, or error message changed. Fix an unintended regression; for an intended change, naturally record it and make an explicit replacement decision during review.

## Reserved diagnostics

`INSTRUMENTATION_UNSUPPORTED` is reserved for a future recognized integration that ReplayLock cannot instrument. It has no currently reachable V1 condition. For V1, an annotated unsupported callable reports `UNSUPPORTED_CALLABLE`; a recording command that never activates the Vite plugin reports `PLUGIN_NOT_ACTIVE`.
