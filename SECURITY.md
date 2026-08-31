# Security policy

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/adammedford/replay-lock/security/advisories/new) to report a suspected vulnerability. Do not disclose exploit details, credentials, captured values, or private source in a public issue or pull request.

If private reporting is unavailable, open a [minimal issue](https://github.com/adammedford/replay-lock/issues/new) asking the maintainer for a private reporting channel. Include no vulnerability details or sensitive material; wait for a private channel before sharing them.

A private report should describe the affected commit, Node and dependency versions, impact, and a minimal reproduction using synthetic data. Do not include live secrets or customer data. If a credential has already been exposed, revoke or rotate it through its provider rather than relying on removal from a report or Git history.

## Supported code and boundaries

ReplayLock is under active development. Security fixes target the current `main` branch; older commits are not maintained as separate release lines. The package remains private to prevent npm publication.

ReplayLock is intended only for local development and test workloads within the [supported V1 environment](README.md#supported-v1-environment). Its analysis and privacy checks are conservative safeguards, not proof that a callable is pure or that recorded values are safe to disclose. Review arguments, completions, adapter payloads, and accepted cases before committing them. Never record production or customer data.
