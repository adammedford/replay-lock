# Gates: Ready-made CI template and documented exit-code contract for verify (issue 33)

OWNS: src/**, scripts/**, test/acceptance/**, docs/**, README.md, examples/**, .github/**, package.json, GATES.md

Scope: a copy-pasteable GitHub Actions example (examples/github-actions/) plus docs/ci.md state the replaylock verify exit-code contract (0/1/2) in one place and distinguish a behavioral regression from an infrastructure failure in the CI step summary; this repo also gets its own CI workflow.

- [x] G0: this ledger states decisive outcomes that can fail
  CHECK: node /Users/adammedford/.claude/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: the project builds and typechecks cleanly
  CHECK: npm run build && npm run typecheck && echo CI_EXAMPLE_TYPECHECK_OK
  EXPECT: CI_EXAMPLE_TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=1a425d51be851a873594042d4384b11b75d3e7c9ec3377e7f9f7c404e347801e; output-bytes=137

- [x] G2: the report script distinguishes all three exit-code cases and preserves the original exit code, the example workflow references it and runs replaylock verify, and a real fixture project in both a passing and a seeded-regression state produces the correct distinct outcome end to end
  CHECK: node scripts/verify-issue-33.mjs ci-example
  EXPECT: CI verify example verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=1c9cf187a0af4e6ff5abcc3c843bac848af4c5db48bf3e0b643ce30ac28e2396; output-bytes=1298

- [x] G3: the complete locked verification suite passes with the new acceptance file registered in the manifest
  CHECK: node scripts/verify-issue-33.mjs all
  EXPECT: issue 33 acceptance suite verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/adammedford/Documents/IsPure; path=401d268cc440/13 entries; EXPECT=matched; output-sha256=22a2c479382d8752649dc243e8e8de4c20dc43fae2fd92b24eca8fd4097b5ac7; output-bytes=293
