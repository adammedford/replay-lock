# What Epic Stack's accepted cases protect (2026-09-27)

The pinned Epic Stack pilot now scores each accepted callable against seeded logic mutants instead of only the return-value regression. Evidence: [epic-mutation-2026-09-27.json](epic-mutation-2026-09-27.json), schema 2, validated with `npm run pilot:dev -- --validate`.

- `replaylock-0.1.0.tgz`, SHA-256 `e349e43746079656f32677e44cd69d690ee6602c7b72674489d72d5e79cda572`, built from this branch
- Epic Stack at `8473afd`, Node 22.19.0, macOS arm64, the four existing workflows, scripted review of every candidate

The journey before the mutation stage matches the [2026-09-23 run](real-app-2026-09.md): 19 eligible callables per realm, 23 observations, 6 candidates, 6 accepted, 6 verified offline, 6 surviving the comment-only edit, and the seeded return regression detected as `OUTPUT_MISMATCH`.

## Mutation results

Each mutant was applied alone to pristine source, verified offline (about 33 s per run), and restored. Detected means `verify` exited 1 with `OUTPUT_MISMATCH`; survived means it exited 0.

| Callable | Cases | Mutants | Detected | Survivors |
|---|---|---|---|---|
| `app/routes/_marketing/index.tsx#meta` | 2 | 1 | 1 | none |
| `app/utils/misc.tsx#getUserImgSrc` | 2 | 3 | 2 | `'/img/user.png'` changed |
| `app/utils/user.ts#isUser` | 2 | 6 | 2 | both `===` flipped, `'object'` and `'string'` changed |

Detected in total: 5 of 10. Each callable has one case per realm with the same arguments, so the browser and Node cases protect the same logic.

What the cases protect:

- **`meta`** returns `[{ title: 'Epic Notes' }]`. The case detects a changed title. That is the whole function.
- **`getUserImgSrc("user/kody.png")`** exercises the branch that builds the image URL. The case detects a swapped branch and a changed URL prefix. It does not detect a change to the default avatar path, because no case covers `getUserImgSrc(undefined)`.
- **`isUser(null)`** exercises only the short-circuit on a falsy argument. The case detects either `&&` becoming `||`, because `typeof null.id` then throws. It does not detect flipped `typeof` comparisons or changed type names, because a null argument never reaches them. The `isUser` logic that matters, recognizing a user object, is unprotected.

The pattern the [spec](../plans/declared-external-calls.md#problem-statement) describes holds: the accepted cases exist, but the logic behind Epic's journeys (loaders, actions, hooks) is not among them. Later slices are judged against this stage, so a slice that adds a callable adds its mutants here.

## Review time

`humanReviewMs` is null: review was scripted. The review-time ceiling that the [ticket README](../plans/declared-external-calls-tickets/README.md) gate uses is not set yet. It needs one review session with a human participant, which this run did not include.

## Blockers report

The [2026-09-24 blockers report](epic-blockers-2026-09-24.md) was regenerated on 2026-09-27 from a clean checkout of the pinned commit with the application's own configuration. Every count is the same (19 eligible, 308 skipped, 122 outside supported shapes with 110 JSX). The only change is the `getHost` root site, now `server/index.ts:159`: the earlier report was generated on a pilot workspace whose `server/index.ts` carried the two-line host edit. The [2026-09-23 report](epic-blockers-2026-09.md) is preserved.
