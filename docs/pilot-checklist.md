# ReplayLock V1 Manual Pilot Checklist

This pilot evaluates whether reviewed observation-based characterization cases save fixture-authoring time and survive ordinary refactors. Collect results manually in a team-owned note or spreadsheet. ReplayLock has no telemetry, hosted service, or upload path: do not upload source or captured values, and do not put them in the pilot log.

## Before each pilot

- [ ] Use only development or test workloads with synthetic or non-sensitive data.
- [ ] Record the locked environment: Node 22, Vite/Vitest versions, ReplayLock version, platform, timezone, and locale.
- [ ] Choose stable exported synchronous boundaries with intentional unit/integration coverage.
- [ ] Seed representative fake credentials and a deliberate output regression in controlled fixtures, never real secrets.
- [ ] Assign a human to inspect every candidate and accepted artifact before commit.

## Measures

Record counts or elapsed minutes without source or value content:

| Measure | How to record it | Initial hypothesis threshold |
|---|---|---|
| Time to first accepted case | Minutes from setup start to first reviewed accepted case | Report; no pass/fail threshold |
| Median review time | Minutes per candidate from display to decision | Under 2 minutes |
| Accepted-candidate rate | Accepted reviewed candidates / all reviewed candidates | At least 30% |
| Behavior-preserving refactor survival | Automatically likely-safe cases still verifying without repair / automatic cases exercised | At least 80% |
| Maintenance time | Minutes repairing, replacing, or retiring cases | Report; no pass/fail threshold |
| False-safe findings | Count and describe category without source/values | Review every finding; no numeric threshold |
| Persisted-secret failures | Seeded fake secrets found in observations, cases, filenames, hashes, logs, diagnostics, or ephemeral names | Exactly 0 |
| Unintended regressions caught | Real unintended behavior changes detected | Report the count |
| Seeded regression caught end to end | Deliberately changed accepted output produces readable failure | At least 1 |
| Adapter module-loading limitations | Worker-local class-token failures from initialization effects, mocks, duplicate modules, or realms | Report; no numeric threshold |

## Run checklist

- [ ] Run `replaylock record -- vitest run`; retain eligible, blocked, safe, partial, and zero-invocation counts only.
- [ ] Run `replaylock review`; time decisions and inspect every argument, completion, adapter ID/version/payload, and accepted JSON before commit.
- [ ] Run `replaylock verify` cleanly; retain only diagnostic codes, exit status, and timing.
- [ ] Exercise behavior-preserving formatting, local renaming, helper extraction, and implementation replacement while preserving the export locator.
- [ ] Move or rename a callable and confirm it becomes orphaned rather than retargeted.
- [ ] Stale a manual assumption and confirm explicit evidence review is required again.
- [ ] For adapters, exercise a class move and an incompatible version through accept-new, verify, and explicit delete-old.
- [ ] Confirm seeded fake secrets are absent from every local and durable surface.
- [ ] Seed at least one output regression and confirm `verify` exits `1` with `OUTPUT_MISMATCH` and a readable diff.
- [ ] Run the locked V1 black-box acceptance suite and record only pass/fail, duration, and tool versions.

## Decision review

- [ ] Calculate every threshold and record blockers separately from feature requests.
- [ ] Review all false-safe findings and privacy failures before expansion.
- [ ] Choose future scope from observed blockers, not a predetermined platform roadmap.
- [ ] Preserve ReplayLock's public seam: record, human review, fresh-process verify.
