# Gates: Batch-friendly candidate review (issue 32)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: `review` gains a fourth decision, `af` (accept remaining in this file), that still prints every subsequent same-module candidate's full review output before accepting it via the exact same per-candidate atomic write path as an individual accept.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo REVIEW_BATCH_TYPECHECK_OK
  EXPECT: REVIEW_BATCH_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=24dae486641be771ff1edc768978398f398ee47ffcb309fd56a83bd8f0c3f2d6; output-bytes=139

- [x] G2: batch accept prints every candidate's review output, is scoped to the current module, and produces byte-identical case artifacts to accepting the same candidates individually
  CHECK: node scripts/verify-issue-32.mjs batch
  EXPECT: batch-friendly candidate review verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=7dc369b1c32ceeeed9e5506666c43bff077ec27adf2290f24d98fa7b64b91cfa; output-bytes=1173

- [x] G3: README documents the af batch-accept option
  CHECK: node scripts/verify-issue-32.mjs docs
  EXPECT: batch review documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=f621aac785ad2ac07e892865e1e4e24ddee788f6f96737ba8786f6d2d97b46e9; output-bytes=36

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-32.mjs all
  EXPECT: issue 32 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=b76790f750419dfa9f3cb2e46696aaf60c4555da6e5295459e8e92638acbee0e; output-bytes=288
