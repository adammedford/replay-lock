# 03: Capture a database-backed loader, proven on the profile page

## Parent

[declared-external-calls.md](../declared-external-calls.md)

## What to build

Prove declared calls in the Node realm on Epic's profile loader, `app/routes/users/$username/index.tsx#loader`. It does three things:
- queries the user by the URL's `username` with `prisma.user.findFirst`;
- throws a 404 `Response` through `invariantResponse` when there is none;
- formats the join date with `toLocaleDateString()`.

The pilot already opens `/users/kody`. Add a visit to a missing username so the 404 path is observed.

The loader needs four capabilities:
- **Destructured parameters.** `({ params })` records only `params`. The rule is sound for patterns without a rest element.
- **`Response` values.** Add `Response` construction to the catalog, and a `Response` encoding for returned and thrown completions (status, headers, body text). Bump `DEV_CATALOG_VERSION`.
- **Trusted packages in development capture.** Honor the existing `trustedPackages` configuration, so a trusted export such as `@epic-web/invariant#invariantResponse` executes at replay without analysis. Without trust, its call to a `message` parameter would be an unknown call for every caller.
- **Locale reads.** Make locale-dependent built-ins such as `toLocaleDateString` traced reads: their result is recorded like `Math.random()`.

Also confirm with the pilot that `db.server.ts` never loads during verify, so the Prisma client is not created and does not connect.

## Acceptance criteria

- [ ] Report-only measurement confirms eligibility before runtime work, with `#app/utils/db.server.ts#prisma` declared and `@epic-web/invariant` trusted.
- [ ] Accepted cases cover a found user and a missing user, and verify with the SQLite database file removed.
- [ ] Changing the `where` clause fails with `TRACE_MISMATCH`. Removing the 404 check or changing the returned fields fails with a completion difference. A behavior-preserving edit passes.
- [ ] Fixtures cover:
  - a rest-pattern parameter, which is still recorded whole;
  - trust that doesn't match the installed version, which fails closed;
  - locale reads replaying their recorded result.
- [ ] Documentation covers destructured parameters, `Response` values, trusted packages in development capture and locale reads.
- [ ] The full gate passes.

## Blocked by

- [02](02-declared-calls-browser-tracer.md)

**Gate:** after this ticket, stop and review the evidence with the user before starting 04.
