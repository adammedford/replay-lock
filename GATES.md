# Gates: Document the async trust boundary (issue 36)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: README, docs/troubleshooting.md, and docs/pilot-checklist.md accurately describe the async capture boundary landed in #27 and #35, including that common Promise patterns fall back to UNKNOWN_EFFECT rather than a special async diagnostic.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the async trust boundary is documented consistently across README, troubleshooting, and the pilot checklist
  CHECK: node scripts/verify-issue-36.mjs docs
  EXPECT: async trust boundary documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=a0c65ee6dcad9721ed1697da0eb8b0e02c4a919ec064ca39a3f016b43492aef8; output-bytes=44

- [x] G2: the complete locked verification suite passes, including the existing documentation-consistency test
  CHECK: node scripts/verify-issue-36.mjs all
  EXPECT: issue 36 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=d832bd50a672fb7a6755891c710f2f1d30e68fde219edfa3b386105a4cce7087; output-bytes=264
