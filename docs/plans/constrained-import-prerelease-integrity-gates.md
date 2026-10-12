# Gates: fixed Node pre-release helper integrity

Scope: actual helper invalidation, equal-content metadata replacement and
canonical-node replacement refuse before release through approved HTTP/witness
seams. Separate source-control refutations and preserved natural review/verify.
Manual gates combine behavior and source review, not automated certificates.
Later-demand witness approval and larger host feasibility remain explicit handoffs.

- [x] G1: actual helper invalidation refuses before the reachable marker and bypassing helper checks refutes it
  EVIDENCE: Actual Vite invalidation passed paired baseline/refusal public test in 11,065 ms; bypassing only current-helper validation made the assertion fail with the marker (exit one, 6,045 ms). Bypass restored. Final standalone case passed after full verification in 10,994 ms, zero pending candidates in both successful controls; no original evaluation with the witness.

- [x] G2: equal-content helper metadata replacement refuses and removing only metadata identity refutes it
  EVIDENCE: Actual equal-content metadata replacement passed in 11,054 ms; removing only metadata object identity, keeping content and other checks, made marker reachable (exit one, 6,033 ms). Check restored. Final standalone case passed in 10,993 ms; actual state, not expected copy, mutated. Source and independently named public test support ownership rather than content-only refusal.

- [x] G3: canonical helper node replacement refuses and removing only canonical lookup identity refutes it
  EVIDENCE: Actual same-prototype/descriptor node replacement in ID/URL/file bucket passed in 11,072 ms. Removing only by-id/by-URL identity checks while preserving other checks made marker reachable (exit one, 6,063 ms); both restored. Final standalone case passed in 10,984 ms. All three new controls paired with unchanged marker reachability, inspected zero candidates and finally-closed hosts; three unavailable-selector reds are not broken-guard evidence.

- [x] G4: natural recording, inspection, explicit review and ordinary verify survive unchanged full and affected-file regressions
  EVIDENCE: Unchanged npm run verify exited zero on Node 22.19.0/npm 11.5.2 including tooling, package/packed consumer and locked/serial-browser acceptance. Subsequent standalone affected file passed 14/14, zero failures/skips, in 173,634 ms aggregate; natural release/review/verify 17,499 ms. All existing 60,000 ms per-test ceilings unchanged. Final typecheck (private JS excluded), four changed-file syntax checks and diff check passed. Six focused staged tests passed after source restoration and review-stage test consolidation. No hosted CI claim.

- [x] G5: independent Standards/Spec reviews and final audit support only the bounded controls and identify the later-witness checkpoint
  EVIDENCE: Independent Standards and Spec source reviews each found zero actionable findings in e7792b3...1292bab. Final source audit confirms all three temporary bypasses restored, core guard predicates unchanged from base, witness-only closed selectors at admission boundaries, expected preparation/late mutation/old tests unchanged and clean/unchanged main at 0867957. Larger native/browser/replay prerequisites are assessed from existing evidence, not new qualification. Later helper-only witness requires explicit agreement to earlier entry/trusted observer delegation; no such witness or new diagnostic was added. Five scoped manual judgments met, not automated completion certificates; full G1B/C2 and general lifecycle remain open.
