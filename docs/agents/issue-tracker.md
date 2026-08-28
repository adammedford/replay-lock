# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, also fetching labels.
- **List issues**: use `gh issue list` with appropriate state and label filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --comment "..."`

The repository is inferred from the configured GitHub remote.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an ambiguous number with `gh pr view <number>` and fall back to `gh issue view <number>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The wayfinding map is a GitHub issue labelled `wayfinder:map`; child tickets are linked as GitHub sub-issues where supported.

- Child labels use `wayfinder:<type>`: `research`, `prototype`, `grilling`, or `task`.
- Use native GitHub issue dependencies for blocking relationships.
- Claim work by assigning the selected issue to the current developer.
- Resolve work by commenting with the result and closing the issue.
- If sub-issues or dependencies are unavailable, use task lists and explicit `Blocked by:` lines.
