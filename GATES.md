# Gates: Resolve trusted-package versions from yarn.lock, classic v1 (issue 31)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: resolveTrustedPackageVersion parses classic Yarn v1's yarn.lock, collecting every block matching the requested package name and returning a version only when every match agrees (a genuine version split falls closed); a Yarn Berry lockfile is detected via its __metadata: block and never misparsed as classic.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo YARN_LOCKFILE_TYPECHECK_OK
  EXPECT: YARN_LOCKFILE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=8067348852452cebe39a4579ef7c22e266a1018b77271515f793a87ed36048fe; output-bytes=140

- [x] G2: yarn.lock version resolution is correct against a real-shaped fixture (scoped names, merged multi-specifier blocks, a genuine version split falling closed, Berry-format rejection), and the full record/review/verify journey plus version-drift-fails-closed both pass against a real classic yarn.lock project
  CHECK: node scripts/verify-issue-31.mjs yarn-lockfile
  EXPECT: yarn.lock trusted-package version resolution verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=9c8f2422526f53ec549f077fa9b07ca859a819dc40e2d403f273ced0c5b3d21b; output-bytes=1464

- [x] G3: docs/trusted-packages.md documents classic-Yarn-only scope, Berry detection, and the version-split fallback
  CHECK: node scripts/verify-issue-31.mjs docs
  EXPECT: yarn.lock trusted-package documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=2a4a06777e1e3f3ccfd6648cb5f57cca4495c36fb84bb47986daaff8f1575187; output-bytes=49

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-31.mjs all
  EXPECT: issue 31 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=1a50d35a2b691bf71255cb8fb7e7e0dfcafd41df02cef904722f01fdbd2c82ad; output-bytes=284
