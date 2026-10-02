# Closed owned numeric table prototype (#126)

Retained experimental branch `prototype/closed-owned-table-init`, based on merged `0867957626ba7a0869fe1fa2753ec311afee60d0`. This is an evaluation, not production delivery or approval to merge. [#126](https://github.com/adammedford/replay-lock/issues/126) defines acceptance; [#123](https://github.com/adammedford/replay-lock/issues/123) owns the subsequent decision. The full [spec](owned-initialization-evaluation.md) and [primary-source research](owned-initialization-research.md) travel with this branch.

## Question and limits

Can a bounded, closed numeric table construction and its finalized primitive reads qualify through public development scan and natural record → review → verify without granting native effects new permission?

The proof belongs at the shared development analyzer seam. Construction and finalized-read qualification are separate obligations. Exact lexical symbols and the entire module's references must establish private ownership and stable reads. Unsupported uses remain unknown and retain ordinary analysis. Live capture and current replay use the same proof. Its revision changes only internal plan identity, not public graph digests, schemas or runtime profiles.

The first slice is a dense finite-numeric array literal immediately followed by a canonical synchronous counter loop, bounded to 256 existing slots and iterations. Only specified primitive arithmetic and direct existing-slot assignments qualify. No calls, aliases, escaping containers, unknown indices, later mutation, appending, iteration, imported facts, coercion, general control flow or ambient constructor assumptions are supported. Source, dependency, configuration, realm and physical-locator drift must requalify current code.

Actual Noble contains unsupported operations beyond private table construction. Synthetic success does not establish admission of its initializer or any of eleven named Epic targets. No application/dependency source is changed, no dotenv values/config hooks/blocked targets are loaded, and no human timing is manufactured. #106 is not completed and #107 does not start. The initial 60000ms ceiling and mandatory #107/#108 checkpoints remain intact.

## Reproduce

Use Node 22.19.0/npm 11.5.2 and a project-local `npm ci`; do not symlink another checkout's dependencies. Chromium must be installed for actual browser tests.

```sh
npm ci
npm run build
node --test test/acceptance/dev-owned-initialization.test.mjs
node --test test/acceptance/dev-owned-initialization-integration.test.mjs
node --test test/acceptance/dev-analysis-cache.test.mjs
npm run typecheck
npm run verify
npm run verify:dogfood
npm run conformance:dev -- --extended
node scripts/dev-conformance.mjs --family idioms --extended
git diff --check
```

The locked manifest includes both prototype acceptance files, with the actual browser integration in its serial pass. Existing fixtures, floors and hazard expectations remain unchanged.

Additional read-only evaluation commands:

```sh
node docs/plans/owned-initialization-epic-scan.mjs APP_ROOT BASELINE_DIST
node docs/plans/owned-initialization-performance.mjs BASELINE_DIST
```

The Epic harness is explicitly a default-development-condition structural comparison with dotenv metadata excluded, not a fresh fully configured qualification. It checks the pinned application revision and selected Noble hashes before/after; unchanged Git status is not a pristine-checkout or whole-tree byte-immutability claim. The performance harness measures public analysis/transforms and saved-source edits with five alternating pairs and one 256-slot table; it is not page latency, human review timing, or replication of the historical 50-percent speedup experiment.

## Observed oracle host limitation

The protected-prototype sentinels are reachable in independent throwaway controls, and latch before throwing outside the application's catch. They are also installed before the positive fixture's first import in both natural HTTP and Chromium workflows. The initializer computes 4/6 without firing their marker-scoped latches, but the existing runtime refuses recording with `INTRINSIC_MODIFIED`: its native-intrinsic contract rejects added numeric accessors and replaced array methods/iterators or number coercion hooks. Those sessions produce zero observations and zero candidates. With protected sentinels retained during public replay, verification likewise refuses with `INTRINSIC_MODIFIED`.

The tests then start separate, fresh clean recording sessions, retaining only the marker-scoped caught-logging oracle. Actual observations returning 4/6 have complete capture provenance, are inspected before explicit review, and verify offline. Independent generated-harness controls demonstrate all five latches fail public verify when deliberately exercised; they are controls, not target-module execution or permission to use native effects.

Successful capture/replay with active protected-prototype sentinels is therefore **not established at this public seam**. The evaluation records the host limitation explicitly, as #126 permits. It does not disable, spoof or relax the intrinsic guard, claim a generic native-effect sandbox, or substitute the clean-session result for successful protected-host capture. Cleanup restores original descriptors including `Array.prototype.length`; defining index zero grows this array's length, and deleting the index alone does not restore it.

## Current pinned application comparison

The [retained JSON](owned-initialization-epic-results.json) reports baseline and prototype each at 20 eligible callables per realm, with **zero of the eleven named targets admitted**. Exact target origins remain Noble `sha3.js:29:5`, Prism `prism.js:1218:2`, Sentry replay `index.js:4019:24`, and OAuth/auth `auth.server.ts:23:19`, separately listed for both realms. Noble 2.0.1 and the three audited source hashes match before and after the scan; the pinned application remains at `8473afd804b66dba6a23f317908dc35d1535e90d` with its existing pilot edits unchanged in Git status.

Noble still requires array appending/method identity, destructuring/iteration, ambient BigInt conversion, nested control flow and imported helper/typed-array obligations beyond this closed dense-table slice. The prototype makes no current named application gain. These are separate from Prism global writes, Sentry initialization/logging, and OAuth environment/constructor work. Return this result to #123; production support requires a separate decision.

## Bounded work and measured overhead

The proof rejects extent/iterations above 256, source indexing above 16384 nodes or depth 192, and primitive evaluation above 32768 visits or depth 128. Exhausted whole-module budgets discard partial proofs. Ordinary modules without a syntactic candidate skip the reference index. Five public boundary/resource fixtures admit the exact 256-slot case and reject 257 slots, overly complex arithmetic, deep parentheses and source-node exhaustion. Their both-realm scan is measured by the focused acceptance file against its existing 15000ms fixture timeout, not a weakened threshold.

The [five-pair public workload measurement](owned-initialization-performance-results.json), with 10/1000 ordinary modules plus one 256-slot owned table in both realms, stays within the additive regression budget of max(20ms, 10% of baseline median). Small-module median overhead is 0.07ms Node and -0.23ms browser; large-module overhead is -13.49ms Node and 3.78ms browser. These are controlled same-process analysis/transform timings, not human or whole-application latency claims. The unchanged historical performance report separately still passes its original checker; it is not a newly repeated historical speedup measurement.
