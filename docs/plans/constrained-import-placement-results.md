# #127: initial controlled-host placement probe

Retained **partial evaluation**, not production code and not completion of #127.
User approved the bounded evaluation and public seams in [the approval record](https://github.com/adammedford/replay-lock/issues/127#issuecomment-5962301291). Base: ef67feb, without merging either earlier precision prototype.

## What this slice tests

Run `node --test test/acceptance/prototype-import-placement.test.mjs` under Node22.19.0, with installed Vite8.2.2 and Playwright Chromium. The test is registered in the locked acceptance manifest and serial browser pass. Dependencies are reused through a worktree-local symlink to the primary checkout; no dependency versions or lockfiles are changed.

The throwaway module `scripts/prototype-import-placement.mjs` creates only synthetic `.mjs` files and fixed trusted Vite configuration (`configFile:false`, `envFile:false`, no application plugins). It serves a controlled HTTP endpoint and fresh browser page. It is not included in package exports or the packed package.

Before execution, a tiny, conservative syntax gate walks the whole entry closure. A rejected graph never reaches Vite evaluation or browser module delivery. Qualified fixtures are transformed by fixed Vite infrastructure into an immutable generation. A runner evaluator checks its exact snapshot before delegating inline execution, refuses all external execution, and reuses only its own generation cache. The browser serves the original Vite client output from that qualified snapshot; direct module URLs encounter the same entry gate.

The six checks exercise HTTP refusal, fresh-page refusal, direct-module URL bypass attempts, builtin/data refusal, reachable isolated throw-only controls in both hosts, and original result7 plus repeated-import namespace identity. The control deliberately executes only the exact standalone synthetic throw marker—not the rejected application graph. No expected recordings or reviewed cases are manufactured.

## Defects found during the red/green slice

- First run failed because the prototype module did not exist. Both refusal assertions initially passed while the positive/control assertions failed, demonstrating why zero-effect output alone is not evidence.
- Physical fixture identity needed canonicalization: macOS `/tmp` and `/private/tmp` otherwise compared differently.
- Replaying Vite's first-fetch invalidation flag on a warm snapshot broke namespace identity. The immutable-generation transport now returns a cache acknowledgment for a known cached module rather than invalidating it again.
- Concurrent requests share one snapshot-preparation promise; cleanup closes HTTP, runner and Vite resources and removes only the fixture directory created by the probe.

## Limits and remaining obligations

These are **placement probes at approved natural HTTP/browser seams**, not live ReplayLock capture or replay adapters. They do not establish full callable qualification, native-effect prevention, transform-drift resistance, stale physical-source revalidation, hostile-code isolation or additional application admissions. The small syntax gate is not a replacement for the shared analyzer. Its invoked-function grammar is merely synthetic fixture support, not an eligibility proof.

The external evaluator refusal is a defensive placement, not independently exercised native-external route coverage. Builtin/data probes are rejected during whole-graph qualification. Warm-cache assertions cover an unchanged, immutable fixture generation only; no claim of HMR, attach or source-replacement safety is made. Browser namespace identity is measured in one fresh page. Each new host uses a new fixture root/runner/page, not nonce URLs.

The mandatory feasibility decision is still open: establish placements in actual live and replay adapters, including Vitest execution routes, with equal source binding before expanding behavior. Recording inspection/review/offline verification, the remainder of the17-row matrix, independent native-effect sentinels, performance/bounds, lost admissions and pinned source-only Epic comparison remain required. No new application/config imports or application/dependency changes occurred; #106 remains open and #107 blocked.
