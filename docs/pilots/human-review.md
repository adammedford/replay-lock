# Human review timing for the pinned Epic pilot

This workflow prepares an untimed session from retained accepted cases, measures a review by the user in a terminal, and validates a separate human evidence file. The existing schema 1/2 scripted reports remain unchanged: `humanReviewMs: null`, `reviewMode: "scripted-synthetic-only"`. No human session has been measured or ceiling chosen by these scripts or their automated tests.

Use Node 22 and run `npm run build` first. The workflow reads the built accepted-case parser, so it checks each artifact's complete V2 schema and computed case ID. It requires a passed schema 2 Epic mutation pilot at `8473afd804b66dba6a23f317908dc35d1535e90d`, the actual tarball whose SHA-256 matches that report, and the complete accepted case directory retained from that run. Source input files and accepted cases are never modified. Each output must be a new file in an existing directory outside the case directory.

The committed [2026-09-27 mutation report](epic-mutation-2026-09-27.json) contains six accepted cases but no case IDs. A report alone cannot reconstruct their identities. Its original temporary workspace and matching tarball must still be available to review that run. If either is missing, rerun the pinned pilot with `--keep-workspace`; do not substitute another run's cases or a newly packed tarball for the old report.

```sh
npm run build
# Pack into an existing directory; keep this exact tarball for validation.
npm pack --pack-destination /absolute/path/fresh-artifacts
node scripts/pilot-dev.mjs --phase final --pilot epic-stack \
  --tarball /absolute/path/fresh-artifacts/replaylock-0.1.0.tgz \
  --output /absolute/path/fresh-artifacts/epic-pilot.json --keep-workspace
```

Use the successful report's `pilots[0].diagnosticWorkspace` plus `/app/.replaylock/cases` as `--cases`. Check that its status is `passed`. The workspace can be moved intact; recorded historical command paths need not still exist. Preserve this report, tarball, and cases together. The older `pilot-dev.mjs --validate` command requires both public pilots, so it rejects a single-Epic report; the human workflow validates the single-Epic input explicitly.

Preparation can happen while the user is unavailable. It records the report byte digest, tarball byte digest, pinned repository/revision, and every accepted case ID, artifact byte digest, callable and realm. Case counts and per-callable counts must agree with the mutation report.

```sh
node scripts/pilot-human-review.mjs --prepare \
  --pilot-report /absolute/path/fresh-artifacts/epic-pilot.json \
  --tarball /absolute/path/fresh-artifacts/replaylock-0.1.0.tgz \
  --cases /absolute/path/retained-workspace/app/.replaylock/cases \
  --output /absolute/path/fresh-artifacts/human-session.json
```

The next action requires the user in an interactive terminal. Replace `USER_PARTICIPANT_ID` with an identifiable user label and `USER_CHOSEN_MS` with a positive per-case ceiling selected by the user. There is no default ceiling. A pseudonym is sufficient if its owner is known to the reviewer of the evidence; the participant field is not an authentication credential.

```sh
node scripts/pilot-human-review.mjs --review \
  --session /absolute/path/fresh-artifacts/human-session.json \
  --pilot-report /absolute/path/fresh-artifacts/epic-pilot.json \
  --tarball /absolute/path/fresh-artifacts/replaylock-0.1.0.tgz \
  --cases /absolute/path/retained-workspace/app/.replaylock/cases \
  --participant USER_PARTICIPANT_ID --ceiling-ms USER_CHOSEN_MS \
  --output /absolute/path/fresh-artifacts/human-review.json
```

The user confirms their participation and chosen ceiling, presses Enter when ready for each case, then reviews the displayed callable, arguments, captured external-input trace, completion, comparison and provenance. The monotonic timer starts as the full artifact is displayed and stops after `accept` or `reject`; invalid answers remain inside the timed interval. Readiness and optional notes are outside timing. Decisions express this review's assessment and do not alter the accepted artifacts. Bring any rejection to the user before relying on the cases.

Both stdin and stdout must be TTYs; piped answers are refused. Interrupted or invalid sessions produce no completed report and remove the reserved new output. A completed file contains the participant, explicit ceiling, per-case elapsed milliseconds and wall-clock timestamps, decisions, total measured time, and an independently checked `ceilingExceeded` flag. An overrun is valid evidence and must be brought to the user under the [ticket gate](../plans/declared-external-calls-tickets/README.md); validation does not convert it into a passing gate. No automatic process should choose the ceiling, supply review decisions, or label its own timing as human.

```sh
node scripts/pilot-human-review.mjs --validate /absolute/path/fresh-artifacts/human-review.json \
  --session /absolute/path/fresh-artifacts/human-session.json \
  --pilot-report /absolute/path/fresh-artifacts/epic-pilot.json \
  --tarball /absolute/path/fresh-artifacts/replaylock-0.1.0.tgz \
  --cases /absolute/path/retained-workspace/app/.replaylock/cases
```

Validation re-reads every original input and rejects digest drift, missing/extra cases, changed identities, missing/nonpositive timings, duplicate decisions, malformed participant/ceiling fields, unsupported fields, scripted mode, inconsistent totals and ceiling results. Review also rechecks input bytes before saving. To collect another session, choose new output filenames. The session/evidence schemas use `artifactKind` to distinguish them from scripted reports and require exact fields.

Evidence limits: matching callable/counts cannot cryptographically prove that a directory came from the historical run, because scripted reports did not preserve case IDs. The operator must select that run's retained cases; the session then pins those exact bytes for subsequent checks. Terminal measurement and the user's attestation support the human-participation claim; a validator cannot independently prove who entered answers or distinguish a forged but structurally valid file. Automated tests use clearly synthetic fixtures solely to exercise those checks and establish no human timing or user ceiling.
