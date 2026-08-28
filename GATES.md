# Gates: Record, review, and verify a directly exported async function with no reachable effects (issue 27)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: relax the source-policy, instrumentation, runtime-capture, and verify-replay boundaries so an exported `async function`/const async arrow with no reachable effects records a candidate, reviews normally, and verifies against a fresh process, while generators and async generators remain rejected and a sync function returning an unawaited promise keeps silently producing no observation.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly with the async capture changes
  CHECK: npm run build && npm run typecheck && echo ASYNC_TYPECHECK_OK
  EXPECT: ASYNC_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=ecfc54941c12d1122afe1f0aa5cc54dc9ea6fa6ec318902a8717430cf7544e48; output-bytes=132

- [x] G2: the async record/review/verify journey is verified end to end, including rejection handling, generator rejection, and the unchanged unawaited-promise skip
  CHECK: node scripts/verify-issue-27.mjs journey
  EXPECT: async record/review/verify journey verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=8e566e41baabfe04d29cb0ea6302743d22aabf426ad3e90afbda2147dfac6080; output-bytes=665

- [x] G3: README documents the async capture boundary
  CHECK: node scripts/verify-issue-27.mjs docs
  EXPECT: async trust boundary documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=a0c65ee6dcad9721ed1697da0eb8b0e02c4a919ec064ca39a3f016b43492aef8; output-bytes=44

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-27.mjs all
  EXPECT: issue 27 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=2c0956ffab3d202c9fa811921a5c183d66e8608e92699b566d3f313dc2fa7f85; output-bytes=252
