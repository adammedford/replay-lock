# Trusted-package catalog for call-graph resolution

## Context

ReplayLock's call-graph analyzer treats *any* import whose specifier doesn't start with `.` as an unresolvable `PACKAGE_CALL` ([call-graph.ts:460](../../src/call-graph.ts#L460), `resolveModule`). That single line disqualifies almost any real-world function that calls into a dependency — `lodash.get`, `date-fns`, `zod`'s `.parse`, even `clsx` — from ever reaching a `likely-safe` verdict. In an adversarial review of the tool's value proposition, this was identified as the single highest-leverage gap: the functions ReplayLock can currently capture (pure, sync, zero-dependency) are exactly the functions that are *already* trivial to hand-test; the moment a function touches any package import — the median case in a real codebase — it becomes ineligible.

The existing `@replaylock assume-pure` mechanism ([assumptions.ts](../../src/assumptions.ts)) already lets a human override unknown evidence, but it's the wrong shape for this problem: it's scoped per capture-target, bundles *all* unknown evidence for that function's entire transitive reachable source into one fingerprint hash, and goes stale on any change to any reachable file — even one unrelated to the actual package call. It gives no way to say once "this specific package export is trusted" and have that reused across every function that calls it.

This plan adds a **project-declared, package-and-export-scoped trust catalog** that plugs into call-graph resolution *before* a package import becomes `PACKAGE_CALL`, so a catalogued call contributes visible "known-safe" evidence instead of unknown evidence — without touching the assumption system, and without ReplayLock shipping opinions about which of the npm ecosystem's packages are pure.

Design decisions already confirmed with the user:
- **No built-in catalog entries.** The mechanism ships empty; every project declares its own trusted packages via `replaylock.config.ts`, matching ReplayLock's "nothing trusted by default" posture and avoiding the maintainers taking on correctness liability for arbitrary third-party packages.
- **Visible, not silent.** A catalog match must produce a visible, low-noise finding in eligibility evidence and case provenance — reviewers should see *which* trusted package a `likely-safe` verdict rests on, unlike the silent pass-through used for `Math.*`/`Number.*` intrinsics.
- **Version-bound by default.** A catalog entry must declare a version range, checked against the project's lockfile-resolved installed version (reusing `selectProjectLockfile`), so a version bump outside the trusted range fails closed back to `PACKAGE_CALL`/unknown. An explicit per-entry opt-out (`versions: "*"` / `unpinned: true`) allows name-only trust for projects that want it.

## Scope for this iteration

Version-lookup parsing is implemented for **`package-lock.json` (npm) only**. `pnpm-lock.yaml`, `yarn.lock`, and `bun.lock(b)` are already recognized as *supported project lockfiles* elsewhere (`SUPPORTED_PROJECT_LOCKFILES` in [project-lockfile.ts](../../src/project-lockfile.ts)), but none of them are currently parsed for package versions anywhere in the codebase, and adding a YAML parser is its own dependency decision. For those lockfiles, catalog entries must use the `unpinned: true` escape hatch until a follow-up adds real version extraction — this is a real, named limitation, not silently dropped.

## Design

### 1. Catalog declaration (`adapters.ts`)

Extend `ReplayLockConfiguration` alongside the existing `valueAdapters` field:

```ts
export interface TrustedPackageExport {
  readonly export: string;           // exact named export, e.g. "get"
  readonly versions?: string;        // semver range; required unless unpinned
  readonly unpinned?: boolean;       // explicit escape hatch, defaults false
}

export interface TrustedPackage {
  readonly package: string;          // exact package specifier, e.g. "lodash"
  readonly exports: readonly TrustedPackageExport[];
}

export interface ReplayLockConfiguration {
  readonly valueAdapters: readonly ValueAdapter[];
  readonly trustedPackages: readonly TrustedPackage[];
}
```

`defineReplayLock` gets a matching `trustedPackages` branch, validated the same way `valueAdapters` is today (exact-own-property reads, Proxy rejection, frozen output). New diagnostic codes follow the existing `VALUE_ADAPTER_*` naming convention, e.g. `TRUSTED_PACKAGE_DEFINITION_INVALID`, `TRUSTED_PACKAGE_ID_DUPLICATE`, `TRUSTED_PACKAGE_VERSION_RANGE_INVALID`.

### 2. Catalog + lockfile resolution (new `src/package-catalog.ts`)

A small module, mirroring the shape of `adapter-validator.ts`:
- `validateTrustedPackages(config)` — structural validation, duplicate detection (same package+export declared twice), semver-range syntax validation for `versions`.
- `resolveTrustedPackageVersion(lockfile: ProjectLockfile, packageName: string): string | undefined` — for now, npm-only: parse `package-lock.json`'s `packages["node_modules/<name>"].version` (or legacy `dependencies[name].version` for older lockfile schema versions). Returns `undefined` for any other lockfile name, which the caller treats as "cannot confirm version" → falls closed unless the entry is `unpinned`.
- `isPackageCallTrusted(catalog, packageName, exportName, lockfile): { trusted: true; matchedVersion?: string; unpinned: boolean } | { trusted: false }` — the single entry point call-graph.ts consults.

This keeps semver range checking (`versions`) isolated from resolution; a lightweight range check is enough (exact version / caret / tilde) — no need to pull in a full semver library given the existing dependency-minimal posture (`typescript`, `vite`, `vitest`, `magic-string` are the only runtime deps today).

### 3. Call-graph integration ([call-graph.ts](../../src/call-graph.ts))

Two hook points, both currently fall through to unknown/unresolved:

- **Named-import calls** (`resolveBinding` → `resolveModule`, [call-graph.ts:460](../../src/call-graph.ts#L460)): before returning `{ problem: { reason: "package" } }`, check the catalog against `(imported.moduleSpecifier, imported.imported)`. On a match, return a new kind of resolution result carrying evidence instead of a problem.
- **Namespace/default-import member-access calls** (`resolveMemberAccess`, the `DETERMINISTIC_INTRINSICS.has(accessPath)` check near it): resolve the receiver identifier back to its import binding first (don't trust the literal dotted text the way intrinsics do — a locally shadowed `lodash` binding must not be trusted), then check the catalog against `(specifier, memberName)`.

Both hook points produce an `Edge` using the **already-existing** `evidence`/`evidenceVerdict` fields on the `Edge` interface (visible near [call-graph.ts:90](../../src/call-graph.ts#L90) and populated around [call-graph.ts:380](../../src/call-graph.ts#L380)) — this is the same mechanism the analyzer already uses to attach findings to an edge without a resolved local target, so no new aggregation logic is needed, only a new finding shape:

```ts
{ code: "TRUSTED_PACKAGE_CALL", source, line, column,
  message: `trusted package call: ${pkg}#${exportName}${matchedVersion ? `@${matchedVersion}` : " (unpinned)"}` }
```

with `evidenceVerdict: "likely-safe"`. Add `"TRUSTED_PACKAGE_CALL"` to `CallGraphReasonCode`. Critically, this code must **not** be added to `UNKNOWN_CODES` or `REFUTING_CODES` in [assumptions.ts](../../src/assumptions.ts) — it's a third category (known-safe evidence), distinct from both. `AnalyzeCallGraphOptions` gains an optional `packageCatalog` field threaded through both hook points.

### 4. Eligibility evidence & case provenance (`model.ts`, `verification.ts`)

`EligibilityEvidence.basis` gains a third value: `"automatic" | "assumption" | "catalog"`. Add an optional field carrying the trusted-package evidence actually relied on (package, export, matched version or `unpinned`, catalog-derived reason codes) — same pattern as the existing `assumption?: AssumptionCaptureEvidence` field, so it's visible in `review` output and persisted in the committed case JSON for auditability.

Verify-time re-qualification already re-runs `analyzeProjectCallGraph` fresh per case ([verification.ts](../../src/verification.ts) `prepareTarget`/`validateEligibility`) and accepts a bare `likely-safe` verdict with no stored assumption. Once `packageCatalog` is threaded into that same `analyzeProjectCallGraph` call (loaded from the project's `replaylock.config.ts` the same way `valueAdapters` already is, in [project-execution.ts](../../src/project-execution.ts)), a catalog-trusted case is re-validated automatically: if the catalog entry is removed or the installed version drifts outside its range on a later `npm install`, the fresh analysis reverts to `PACKAGE_CALL`/unknown and verify correctly fails with the existing `MISSING_ASSUMPTION` (no assumption ever existed) or a new equivalent — worth a small addition so the failure message says "trusted package entry no longer matches" rather than reusing assumption wording verbatim. No new verify-time code path is needed beyond threading the catalog through and this one message check.

### 5. Threading the catalog through `record`/`review`/`verify` (`project-execution.ts`, `cli.ts`, `session.ts`)

Follow the exact existing path for `valueAdapters` ([project-execution.ts:369](../../src/project-execution.ts#L369) `{ valueAdapters: valueAdapterRegistry }`): wherever that registry is built from the loaded project configuration, also validate and build the resolved `packageCatalog` (which requires reading the lockfile once via `selectProjectLockfile`, already used elsewhere) and pass it alongside into every `analyzeProjectCallGraph` call site (record's preflight, the Vite plugin's instrumentation-time analysis, and verify's preflight).

## Files touched

- `src/adapters.ts` — config shape + validation for `trustedPackages` (extends existing `defineReplayLock`/`ValueAdapterConfigurationError`-style pattern)
- `src/package-catalog.ts` — **new**: catalog validation, npm lockfile version resolution, trust lookup
- `src/call-graph.ts` — two resolution hook points, new `TRUSTED_PACKAGE_CALL` reason code, `packageCatalog` option
- `src/assumptions.ts` — confirm `TRUSTED_PACKAGE_CALL` is excluded from `UNKNOWN_CODES`/`REFUTING_CODES` (no functional change otherwise)
- `src/model.ts` — `EligibilityEvidence.basis` gains `"catalog"`, new evidence field
- `src/verification.ts` — thread `packageCatalog` into `prepareTarget`, message wording for a reverted catalog match
- `src/project-execution.ts`, `src/cli.ts`, `src/session.ts` — load/validate/thread the catalog the same way `valueAdapters` is threaded today
- `README.md` — new `## Trusted packages` section (config example, `TRUSTED_PACKAGE_*` diagnostic codes), extend the stable diagnostics list
- `docs/value-adapters.md` sibling doc, e.g. `docs/trusted-packages.md`, explaining the trust model and its limits (name+export scoped, version-bound, npm-only version resolution for now)

## New/updated tests

Mirror the existing adapter test suites' structure:
- `test/acceptance/package-catalog-validation.test.mjs` — config validation, duplicate detection, invalid ranges (unit-level, like `adapter-validation.test.mjs`)
- `test/acceptance/package-catalog-integration.test.mjs` — black-box record→review→verify fixture: a fixture project with a `package-lock.json`-pinned dependency, a captured function calling into it, both a version-in-range and version-out-of-range case, asserting `TRUSTED_PACKAGE_CALL` evidence appears in the candidate and that a version bump reverts to `PACKAGE_CALL`/fails verify (like `adapter-integration.test.mjs` / `adapter-evolution.test.mjs`)
- Add both to `scripts/run-verification.mjs`'s locked `acceptanceFiles` manifest (the manifest is asserted complete, so a new file must be added there or the suite runner fails closed)

## Verification

1. `npm run build && npm run typecheck`
2. `npm run verify` (runs the full locked acceptance suite plus the two new files once added to the manifest)
3. Manual smoke check: a temp fixture with `import { get } from "lodash"` in a `@replaylock capture` function, a `replaylock.config.ts` trusting `lodash#get`, and its own `package-lock.json` — confirm `record` produces a candidate with `TRUSTED_PACKAGE_CALL` evidence, `review` displays it, `verify` passes, then bump the lockfile's lodash version out of the declared range and confirm `verify` fails closed rather than silently passing.
