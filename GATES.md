# Gates: Resolve trusted-package versions from bun.lock (issue 29)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: resolveTrustedPackageVersion parses Bun's text bun.lock (JSONC) lockfile, correctly splitting a scoped or unscoped "name@resolution" string on its last `@`, so a project on Bun gets real version-bound trusted-package trust instead of being forced to unpinned:true. bun.lockb (binary) remains unparsed.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo BUN_LOCKFILE_TYPECHECK_OK
  EXPECT: BUN_LOCKFILE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=80fee53f7775afed4996fc9375b7531c777129465427a03b8c054f59ea5befe8; output-bytes=139

- [x] G2: bun.lock version resolution is correct against a real-shaped fixture (scoped and unscoped names, malformed content, non-semver git resolution, bun.lockb unchanged), and the full record/review/verify journey plus version-drift-fails-closed both pass against a real bun.lock project
  CHECK: node scripts/verify-issue-29.mjs bun-lockfile
  EXPECT: bun.lock trusted-package version resolution verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=d944184bba45235e49f9f353de7ef3d37138d3a57f53c2317be8cfa7dcab6f9f; output-bytes=1668

- [x] G3: docs/trusted-packages.md documents bun.lock support and the scoped-name split rule, keeping bun.lockb listed as unparsed
  CHECK: node scripts/verify-issue-29.mjs docs
  EXPECT: bun.lock trusted-package documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=f5cf0eb45343c41321b0cdfdff2ee35de09f74eb78fb85d1dd372a05f4179425; output-bytes=48

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-29.mjs all
  EXPECT: issue 29 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=5301502e510783b6cd264c8c13643b025f517c66ca3b4774115acdbcffe79784; output-bytes=273
