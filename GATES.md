# Gates: Trusted-package catalog for call-graph resolution (issue 21)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, GATES.md

Scope: implement the project-declared, package+export+version-scoped trusted-package catalog described in GitHub issue 21, so a catalogued package call contributes visible TRUSTED_PACKAGE_CALL evidence instead of unknown PACKAGE_CALL evidence across record/review/verify, and both new acceptance test files plus README/docs document it.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly with the new trusted-package modules
  CHECK: npm run build && npm run typecheck && echo TRUSTED_PACKAGE_TYPECHECK_OK
  EXPECT: TRUSTED_PACKAGE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=0f822d2abfe14d0a42ca8a8b2eadec7674fdf8d8c69b2f9cf14be3e4de08fe4d; output-bytes=142

- [x] G2: trusted-package catalog validation (structural, duplicate, semver-range syntax, npm lockfile version resolution, CLI fail-closed on malformed config) is verified
  CHECK: node scripts/verify-issue-21.mjs validation
  EXPECT: trusted package catalog validation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=52da9d880b8c73ed9aa10fa7090a156381ffd06431967c2cd6f126b01bc836df; output-bytes=1334

- [x] G3: the trusted-package catalog record-review-verify journey is verified, including TRUSTED_PACKAGE_CALL evidence, namespace/default-import member access, shadowed-binding non-trust, and version-drift/removal reverting to fail-closed on verify
  CHECK: node scripts/verify-issue-21.mjs integration
  EXPECT: trusted package catalog integration verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=1341e6827dfb0923ed9aefd1a25dbd94dbe72467eb1ddae55c7d3fbc96e22d2c; output-bytes=982

- [x] G4: README and docs/trusted-packages.md document the trust model, config shape, diagnostic codes, and the npm-only version-resolution limitation
  CHECK: node scripts/verify-issue-21.mjs docs
  EXPECT: trusted package catalog documentation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=02d555470d3b1fb50c92ffbfdbe0178b73c73f71ba345234839376700d649ac3; output-bytes=47

- [x] G5: the complete locked verification suite passes with both new acceptance files registered in the manifest
  CHECK: node scripts/verify-issue-21.mjs all
  EXPECT: issue 21 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=d1a1d6b7d90077b4f5b7a74c19632cdbfa542d6b6e4b505deef6653d32937c4c; output-bytes=250

<!--
Replace every placeholder before running the checker.
-->
