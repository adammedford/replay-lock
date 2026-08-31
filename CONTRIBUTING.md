# Contributing to ReplayLock

Start with a [GitHub issue](https://github.com/adammedford/replay-lock/issues) for a bug report or proposed change. Include the expected behavior, a minimal reproduction using synthetic data, and the relevant Node and dependency versions. For vulnerabilities, follow [the security policy](SECURITY.md) instead of posting details publicly.

## Development setup

Use **Node 22.19.0** from `.nvmrc` and **npm 11.5.2** from `package.json`. Other Node majors are outside this repository's verification contract. If you use nvm:

```sh
nvm install
nvm use
npm install --global npm@11.5.2
```

Otherwise, install those same versions with your preferred toolchain manager. Confirm them before installing dependencies:

```sh
node --version
npm --version
npm ci
```

## Making a change

Keep changes focused on the originating issue and add regression coverage at the public behavior being changed. Preserve ReplayLock's `record → review → verify` contract: observe calls naturally, review every accepted behavior explicitly, and fail closed when replay is unsafe. Do not generate expected values by invoking a target solely to manufacture a recording.

Use synthetic inputs only. Pending observations and verification scratch files are ignored; reviewed cases under `.replaylock/cases/` are eligible for source control only after inspecting their complete contents. Never auto-accept recordings or commit credentials, customer data, or local execution logs.

Before submitting a pull request, run:

```sh
npm run typecheck
npm run verify
git diff --check
```

`npm run verify` builds the package and runs its contract checks and the complete locked acceptance suite. Do not replace it with only a focused test run or remove tests from the manifest to obtain a passing result. Focused checks are useful while iterating, but the full verification command is the handoff requirement.

## Pull requests

Submit changes through a pull request targeting `main`, including for maintainer-authored changes. Link the issue, explain the behavior and safety implications, and include the commands and results used to verify the change. Keep the branch up to date and resolve review conversations before merging. Do not bypass required checks or push changes directly to `main`.

ReplayLock uses the [MIT license](LICENSE). Keep license notices intact. The public source repository does not imply an npm release: `package.json` intentionally retains `"private": true`.
