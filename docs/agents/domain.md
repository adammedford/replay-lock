# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `CONTEXT-MAP.md` instead, if present.
- Relevant ADRs under `docs/adr/`.

If these files do not exist, proceed silently. Domain-modeling skills create them lazily when terminology or architectural decisions are resolved.

## File structure

This is a single-context repository:

/
├── CONTEXT.md
├── docs/adr/
└── src/

## Use the glossary's vocabulary

When naming a domain concept, use the term defined in `CONTEXT.md`. Avoid synonyms the glossary explicitly rejects.

If a needed concept is missing, reconsider whether the language belongs to the project or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface that conflict explicitly rather than silently overriding the decision.
