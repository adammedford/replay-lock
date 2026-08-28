# Gates: Resolve trusted-package versions from pnpm-lock.yaml (issue 30)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: resolveTrustedPackageVersion reads a project's own resolved dependency version from pnpm-lock.yaml's importers.'.' block (not the flat packages map, which has no notion of "the version this project uses"), via a hand-rolled indentation-based YAML block scanner rather than a new dependency, truncating peer-dependency-qualified versions to their base semver.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo PNPM_LOCKFILE_TYPECHECK_OK
  EXPECT: PNPM_LOCKFILE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=b55bea539b4f839d0e91d9f89b9909e0798c9351669fe06be76fe270496364cd; output-bytes=140

- [x] G2: pnpm-lock.yaml version resolution is correct against a real-shaped fixture (scoped names, peer-qualified versions, absent importers/root), and the full record/review/verify journey plus version-drift-fails-closed both pass against a real pnpm-lock.yaml project
  CHECK: node scripts/verify-issue-30.mjs pnpm-lockfile
  EXPECT: pnpm-lock.yaml trusted-package version resolution verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=539da65586023dcb69cbd59ff0eebcf0af36fadb69c042712c8d597e90530dcb; output-bytes=1449

- [x] G3: docs/trusted-packages.md documents pnpm-lock.yaml support, the importers-not-packages-map rule, and the peer-suffix truncation rule
  CHECK: node scripts/verify-issue-30.mjs docs
  EXPECT: pnpm-lock.yaml trusted-package documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=daff715a5e142e2d97447bd606c481483273286eb6d15d91b69d0b48b7c7bb7c; output-bytes=54

- [x] G4: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-30.mjs all
  EXPECT: issue 30 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=6ccdf3708b472e351550b9bf12e1458f50ee59b5c7c65790dd4c20ccbc7bdfc9; output-bytes=279
