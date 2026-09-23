# Responsiveness equivalence fixtures

These synthetic expectations were generated using the unmodified built analyzer and transformer at `2f9ff9467608a458e4f37ddc53aec3a6c40d28af`, not the optimized implementation.

`effects-baseline.json` retains complete initialization and callable findings, including ordering and source locations. Its original nested-function behavior is now selected explicitly with `nestedFunctions: "skip"`, matching development analysis. PR #76 separately changed the V1 default to descend into nested functions; the shared-context test exercises both modes and the merged scan tests cover that safety fix.

`project-baseline.json` retains complete analyses, transformations, source maps and graph digests for both realms across unsafe dependency, safe transitive helper and effectful initialization stages. Absolute fixture roots are normalized to `$root`; source contents and digest inputs are otherwise unchanged. The current cache is exercised across the stages, including shifted-source overlays.

Do not regenerate these expectations from the optimized analyzer merely to make a failing test pass. Investigate any changed decision or evidence against the recorded base and any separately approved semantic change.

Approved semantic change (reference-scoped module initialization, 2026-09-22): stage 3's dependency initializes `const initial=Date.now()`, which `helper` never reads. Module initialization now taints only what can observe it, so `main` is eligible in stage 3. Only stage 3's `realms` were regenerated, from the implementation that made this change; stages 1 and 2 and every source input were verified byte-identical before writing.
