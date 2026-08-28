# Gates: Prove and harden effect propagation through await (issue 35)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: prove that known-effect, ambient-mutation, assumption, and trusted-package-call evidence attribute correctly when reached only through await (direct, looped, conditional, and multi-hop async chains), and that Promise.all/Promise executor construction never reach a false likely-safe verdict. Investigation found the existing generic unresolved-global-constructor and unresolved-member-access fallbacks already fail closed for Promise/Promise.all with no source changes required; this ledger proves that with tests rather than adding redundant special-casing.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo ASYNC_EFFECTS_TYPECHECK_OK
  EXPECT: ASYNC_EFFECTS_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=83e8461fd22fbde2d85e4eb141bacfac911b0720070fcc8198248f58cf2435c2; output-bytes=140

- [x] G2: unit-level call-graph coverage proves await-reached effects, ambient mutation, loop/conditional/multi-hop propagation, Promise.all, Promise executor construction, and trusted-package-call evidence all classify correctly
  CHECK: node scripts/verify-issue-35.mjs effects
  EXPECT: async effect propagation unit coverage verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=49adb28d2b8719be8837e0cca5f15710c0107449e23d74a7b188ff9eb03f5b34; output-bytes=2194

- [x] G3: CLI-level integration coverage proves an async assume-pure case and an async trusted-package case both record, review, and verify end to end with the correct persisted eligibility basis
  CHECK: node scripts/verify-issue-35.mjs integration
  EXPECT: async effect propagation integration coverage verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=549544581d0a024918387fcb9b208bf048f71987b21b69528420f4c1cacf85f8; output-bytes=936

- [x] G4: the complete locked verification suite passes with both new acceptance files registered in the manifest
  CHECK: node scripts/verify-issue-35.mjs all
  EXPECT: issue 35 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=6fb03af84b61018a5a84e1fcaaaa03af9c95eedf6533a36e676e524431cf50db; output-bytes=264
