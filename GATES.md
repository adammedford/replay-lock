# Gates: Fix case-fold collision test for real case-sensitive filesystems (CI fix)

OWNS: test/acceptance/source-policy.test.mjs, GATES.md

Scope: the "callable locators reject case-fold collisions" test always skipped on macOS's case-insensitive default filesystem and had never actually executed until the first real CI run (issue #33) exposed it on Linux. The test's expectation ("Recorded 1 candidate(s)") did not match the analyzer's actual, conservative whole-file import-taint behavior (an unresolved sibling import taints every capture target in the same importing file, including one that never calls into the ambiguous imports). Correct the test's expectation to match current behavior; no src/ changes. Verified against a real case-sensitive APFS volume (hdiutil-created for this session), not just inferred.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the specific case-fold-collision test passes for real on a genuinely case-sensitive filesystem (not skipped)
  CHECK: TMPDIR=/Volumes/ReplaylockCaseTest/ node --test --test-concurrency=1 test/acceptance/source-policy.test.mjs
  EXPECT: # pass 8
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=9c4569972579189648a61c61f643e5d5ddb66f164eb2c6bed79e5bd7c1999ba0; output-bytes=1863

- [x] G2: the complete locked verification suite passes on a genuinely case-sensitive filesystem, catching any other latent case-sensitivity assumptions
  CHECK: cd /Users/adammedford/Documents/IsPure && TMPDIR=/Volumes/ReplaylockCaseTest/ npm run verify
  EXPECT: verification suite passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=ab4df1882b779931dda8b1141bbf85f18bb2e3acd1ae22d0a7efb6f2f3cd7baf; output-bytes=330

- [x] G3: the complete locked verification suite still passes on the default (case-insensitive) filesystem, confirming no regression to the normal local/CI-macOS path
  CHECK: npm run verify
  EXPECT: verification suite passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=ab4df1882b779931dda8b1141bbf85f18bb2e3acd1ae22d0a7efb6f2f3cd7baf; output-bytes=330
