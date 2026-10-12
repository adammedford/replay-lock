# Gates: fixed Node retained context identity

Scope: refuse equal-content replacement of the retained entry exports context
before delegation, using only the approved ordinary HTTP delegate witness.
Manual gates combine public behavior and source review; not automated certificates.

- [x] G1: unchanged context reaches the marker while equal-content exports replacement refuses before it
  EVIDENCE: Actual replacement control reached the marker on the old comparator (red, exit one, 6,054 ms). Identity comparison passed the paired unchanged/replacement test (11,028 ms), and restored focused staged tests passed 3/3 with zero failures/skips. Final standalone replacement case passed in 11,047 ms after full verification. Both successful witness cases inspected zero pending candidates and closed hosts. Marker is dispatch reachability, not native execution evidence.

- [x] G2: restoring content-only comparison refutes the public replacement assertion without original evaluation
  EVIDENCE: Restoring only old descriptor deep equality made the same replacement assertion fail with marker instead of typed refusal (exit one, 5,997 ms). The identity comparison was immediately restored. Workflow and attachment require the private control to have staging and witness enabled, preventing any original evaluator call with substituted exports. Independent source reviews confirm expected records/source/late mutation are untouched; no new diagnostic seam.

- [x] G3: original natural recording/review/verify and unchanged full regression remain intact
  EVIDENCE: Unchanged full npm run verify exited zero on Node 22.19.0/npm 11.5.2, including tooling, package/packed-consumer and locked/serial-browser acceptance. Subsequent standalone affected file passed 11/11 with zero failures/skips in 141,694 ms aggregate; original late-drift witness 11,063 ms, context replacement 11,047 ms, natural release/review/verify 17,646 ms. Existing 60,000 ms per-test ceilings unchanged. Final typecheck (private JavaScript excluded), four changed-file JavaScript syntax checks and diff check passed. No hosted CI claim.

- [x] G4: independent Standards/Spec reviews and final source audit support only top-level retained descriptor identity
  EVIDENCE: Independent Standards and Spec reviews each found zero actionable findings on the implementation tree (reviewed as f615761, now 2db67ec after unpublished commit email metadata repair). Both trees are identical at 8d834feda88717609300a3c22bc4cbdca6137fec. Driver reread pinned Vite exports allocation/context/consumption and both disk hashes; source-only background research independently identified the content-versus-identity gap. Final source audit confirms identity check restored, no temporary bypass/logging, private probe restricted to staged+witness workflow/attachment, original late mutation/expected preparation/natural tests unchanged, and main clean/unchanged at 0867957. Four scoped manual judgments, not automated certificates; nested state, later-demand interference, general invalidation/cache, native/transitive, browser/replay, full G1B and C2 remain open.
