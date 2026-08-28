# Gates: replaylock scan reports project-wide capture eligibility without executing tests (issue 28)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: a new `replaylock scan` command reports capture eligibility for every exported function, annotated or not, reusing record's preflight analysis, with no test execution, no Vite/Vitest requirement, and no writes under `.replaylock/`; it always exits 0.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly with the new scan command
  CHECK: npm run build && npm run typecheck && echo SCAN_TYPECHECK_OK
  EXPECT: SCAN_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=4bf66774391ce77c675a7cabc9d7d2a7b4d9f689702359aeca3df0506f0e23d5; output-bytes=131

- [x] G2: scan reports accurate eligibility for annotated and unannotated exported functions, makes no .replaylock/ writes, and exits 0 even with zero eligible functions
  CHECK: node scripts/verify-issue-28.mjs scan
  EXPECT: scan command verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=c9ddd85e0946ebb5b625f335b647b1a5f82162fd0ea668d4b2e89c3d58113e15; output-bytes=873

- [x] G3: README documents the scan command and its status codes
  CHECK: node scripts/verify-issue-28.mjs docs
  EXPECT: scan command documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=9f04964aad103914a7686736b7f28791e18c33fe490b4416847d04c7053873f8; output-bytes=36

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-28.mjs all
  EXPECT: issue 28 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=02ffa05421309f201dac7c3069b683e064bc7cd924b392a36585f39efbfbe337; output-bytes=267
