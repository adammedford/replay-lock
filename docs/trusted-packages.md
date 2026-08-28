# Trusted Packages

Any import specifier that isn't a relative path (`lodash`, `date-fns`, `@scope/pkg`) contributes unknown `PACKAGE_CALL` evidence by default. ReplayLock's static analysis never inspects package internals, and it ships no built-in opinion about which npm packages are pure — every trust decision is an explicit, reviewable, per-project opt-in.

A trusted-package catalog lets a project vouch for one specific export of one specific package, bound to a semver range checked against the version actually installed in the project's lockfile. A catalogued call contributes visible `TRUSTED_PACKAGE_CALL` evidence instead of unknown evidence, so the calling callable can reach a `likely-safe` verdict without an `@replaylock assume-pure` override.

## Declare a catalog entry

```ts
// replaylock.config.ts
import { defineReplayLock } from "replaylock";

export default defineReplayLock({
  trustedPackages: [
    {
      package: "lodash",
      exports: [
        { export: "get", versions: "^4.17.0" },
        { export: "isEqual", unpinned: true },
      ],
    },
  ],
});
```

Each `TrustedPackage` names an exact package specifier and a list of exports. Each `TrustedPackageExport` names one exact named export and requires a `versions` range unless it opts out with `unpinned: true` (equivalently, `versions: "*"`). Trusting `lodash#get` does not imply trusting `lodash#template` or any other export of the same package — every export is its own declaration.

`versions` accepts an exact version (`"4.17.21"`), a caret range (`"^4.17.0"`), or a tilde range (`"~4.17.0"`), matching the project's dependency-minimal posture rather than a full semver implementation. A malformed range string is rejected at configuration load with `TRUSTED_PACKAGE_VERSION_RANGE_INVALID`, never silently accepted or treated as matching everything. A duplicate `package`+`export` pair declared twice is rejected with `TRUSTED_PACKAGE_ID_DUPLICATE`. A malformed catalog entry (wrong shape, a Proxy, symbol properties) is rejected with `TRUSTED_PACKAGE_DEFINITION_INVALID`, the same defensive posture already used for Value Adapters.

## What gets trusted

Both a named-import call (`import { get } from "lodash"; get(...)`) and a namespace or default import's member access (`import _ from "lodash"; _.get(...)`) are checked against the catalog. Catalog matching is based on the resolved import binding, not the literal dotted text: a local binding that shadows a trusted import's name (a same-named parameter or local variable) is never treated as trusted.

`record`'s preflight, the Vite plugin's instrumentation-time analysis, and `verify`'s preflight all consult the same resolved catalog, so eligibility stays consistent across the whole record/review/verify journey. `review` displays which trusted package and matched version (or `unpinned`) a `likely-safe` verdict rests on, and an accepted case's provenance records that same evidence for later audit.

## Version resolution: npm, Bun's text lockfile, pnpm, and classic Yarn

Installed-version lookup is implemented for four lockfiles:

- `package-lock.json` (npm): reads `packages["node_modules/<name>"].version`, falling back to the legacy `dependencies[name].version` shape for older lockfile schema versions.
- `bun.lock` (Bun's text lockfile, JSONC): reads `packages[<name>][0]`, a `"<name>@<resolution>"` string, and splits on the *last* `@` to extract the resolution — correctly handling a scoped name's own leading `@`. A non-semver resolution (a git ref, a workspace link) is returned as-is; the semver-range check below rejects it rather than matching it.
- `pnpm-lock.yaml`: reads `importers.'.'.<dependencies|devDependencies|optionalDependencies>.<name>.version` — the version pnpm actually resolved for *this project's own* declared dependency — rather than the flat `packages` map, which keys every transitively resolved version of every package with no notion of "the one this project uses." A peer-dependency-qualified version (`1.6.4(@types/node@22.0.0)`) is truncated to its base semver before the range check runs. Parsing is a small hand-rolled indentation-based block scanner tailored to the narrow, highly regular YAML subset pnpm itself emits, not a general YAML library — matching this project's dependency-minimal posture. A pnpm workspace whose root importer key isn't `.` (a monorepo) is outside this scope and falls back to "cannot confirm."
- `yarn.lock`, **classic Yarn v1 only**: classic yarn.lock has no single "the top-level resolution" marker the way npm, pnpm, and Bun's formats do — every distinct range that resolved to a distinct version gets its own flat top-level block, whether hoisted or not, so the same package name can legitimately appear more than once with *different* versions. Every block matching the requested package name is collected, and a version is returned only when every match agrees; a real version split (confirmed against real-world lockfiles during development) falls back to "cannot confirm" rather than guessing which occurrence is the project's own. Yarn Berry (v2+) reuses the `.lock` extension for a materially different, real-YAML format identified by a top-level `__metadata:` block; a Berry-format file is detected and never misparsed as classic — it falls back to "cannot confirm" the same as an unsupported lockfile.

`bun.lockb` (Bun's older binary format) is recognized as a supported project lockfile elsewhere, but is not parsed for package versions. A project on that lockfile, or on Yarn Berry, must use `unpinned: true` for a catalog entry until a follow-up adds real version extraction — this is a named limitation, not a silent gap. Without a version-bound match, the call reverts to ordinary unknown `PACKAGE_CALL` evidence.

## Verification stays honest

`verify` re-runs call-graph analysis fresh per case, exactly as it does today, and threads the *current* catalog and the *current* installed version into that same analysis. A version bump that moves the installed package outside a declared range, or removal of the catalog entry itself, reverts the call to unknown evidence and fails verification closed with a message explaining that the trusted-package entry no longer matches — never a silent pass.

`TRUSTED_PACKAGE_CALL` is its own known-safe evidence category. It is never treated as evidence that an `@replaylock assume-pure` assertion can refute or must discharge, and declaring a catalog does not change how the assumption mechanism itself fingerprints or ages.
