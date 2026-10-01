# Epic participant review — 2026-10-01

The user (`adam`) completed the real terminal review prepared after PR #110 and selected an initial **60-second ceiling per case**. [Human evidence](human-review-2026-10-01/human-review.json) and the [prepared session](human-review-2026-10-01/human-session-durable.json) are separate from scripted pilot reports: scripted `humanReviewMs` remains null.

| Callable | Realm | Decision | Timed review |
| --- | --- | --- | --- |
| `getUserImgSrc` | Node | accept | 36.960 s |
| marketing `meta` | Node | accept | 17.919 s |
| marketing `meta` | browser | accept | 14.141 s |
| `isUser` | browser | accept | 20.002 s |
| `isUser` | Node | accept | 17.442 s |

All five cases were accepted; none exceeded the ceiling. Total timed review was **106.464 seconds**, maximum **36.960 seconds**. Readiness and optional notes are outside the timer. These measurements describe review effort for these five cases, not a prediction for future callables or a claim of valuable coverage.

## Provenance and preservation

The session pins Epic revision `8473afd804b66dba6a23f317908dc35d1535e90d`, exact report digest `3c83eb735b8991297a27b095cd47e300c21ae741d5753e4c4778ea4013a95482`, and exact package digest `30d7213b5768d90d14fcd9a796c39530423d091bf5ea9c854ee951afb5dda0dc`. The fresh scripted run had five accepted cases, offline replay, a surviving no-op edit and five detected mutants of ten. It is not the older six-case 2026-09-27 run.

The [five reviewed artifacts](human-review-2026-10-01/cases/) are preserved byte-for-byte, with synthetic inputs and empty external traces. Their complete contents were inspected before inclusion. The artifacts preserve their original `captureStatus: partial`; review does not retroactively claim complete application capture. They protect a URL formatter, static marketing metadata and a null user guard; this is limited value, not broad application coverage.

Full `pilot-human-review.mjs --validate` passed against the original prepared session, machine report, exact package and all five case files. Original package and machine report are retained locally in the operator's original checkout with the source session under `.unlazy/post-110/pilot-artifacts/`; they are not duplicated here or available in a fresh clone. This archive supports schema, case identity and case-byte digest checks, but full historical provenance validation also requires those retained originals. Do not substitute a newly packed tarball or a different run's report. See the [workflow and evidence limits](human-review.md).

## Gate decision

The real participant timing prerequisite in #105 is satisfied: five accept decisions within the user-selected 60000 ms ceiling. #106 may proceed. The ceiling is initial; retain it for subsequent slices unless the user explicitly changes it. Mandatory evidence checkpoints after #107 and #108 remain unchanged. An overrun, rejected case or missing named-callable proof must be surfaced, not hidden by revising the ceiling or timings.
