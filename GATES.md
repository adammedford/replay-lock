# Gates: Opt-in numeric-tolerance comparison mode (issue 34)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: an explicit, per-case, review-time-only comparison.kind:"tolerance" option lets a reviewer accept a candidate with a numeric epsilon instead of exact equality; number leaves compare within epsilon while every other value kind still requires exact equality; existing "exact" cases are unaffected and need no schema migration.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo TOLERANCE_TYPECHECK_OK
  EXPECT: TOLERANCE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=f10fd67b474b18650c79797fa44f439cd3536980ed39c31779a5eb559695046d; output-bytes=136

- [x] G2: a candidate can be accepted with an explicit tolerance and the choice is visible and round-trips in the persisted case, an invalid epsilon is rejected rather than defaulted, verify passes within epsilon and fails outside it while non-numeric parts still require exact equality, and an existing exact-comparison case remains completely unaffected
  CHECK: node scripts/verify-issue-34.mjs tolerance
  EXPECT: numeric tolerance comparison mode verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=492c80733d38a6979bcaf49b97b9117d7288475e75afcf5807a8028ecbf0502f; output-bytes=1839

- [x] G3: README documents the new comparison mode, its schema shape, and the no-migration decision
  CHECK: node scripts/verify-issue-34.mjs docs
  EXPECT: numeric tolerance comparison documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=b9fd62ec5b20df7249a458739352e12596296284d176d295fea4bee860795163; output-bytes=52

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-34.mjs all
  EXPECT: issue 34 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=32f69572cb9f031441378e1f0d4d5569ee76949fa21594f4d4b421286f96f0b5; output-bytes=301
