# 04: Capture authenticated request handling without recording sessions

## Parent

[declared-external-calls.md](../declared-external-calls.md)

## What to build

Extend capture to callables that receive a `Request`, without writing cookies to case files. Epic targets:
- `requireUserId`: builds the login redirect, including `redirectTo`;
- `requireAnonymous`;
- the login and logout loaders;
- the user-search loader;
- `useOptionalUser` and `useUser`.

Add a seeded-user login and logout to the pilot journey.

The targets need these capabilities:
- **Minimal `Request` encoding.** Encode URL, method, and only the headers analyzed code reads by literal name. Any other header read blocks the callable.
- **Argument references.** A value from the callable's own arguments passed to a declared call is recorded as a reference such as `$0.request`, not by value. With `#app/utils/auth.server.ts#getUserId` declared, `requireUserId` never records the session cookie.
- **Request body reads.** `request.formData()`, `.json()` and `.text()` become traced reads, mirroring fetch response body readers.
- **Application adapters.** Epic's configuration adds Value Adapters for Prisma's `TypedSql` and react-router's `DataWithResponseInit`. This is documented integration wiring, not a dependency change.

## Acceptance criteria

- [ ] Report-only measurement lists which targets become eligible before runtime work. Any target needing an unlisted capability is recorded as blocked, not forced.
- [ ] Captured targets produce accepted cases that verify offline. No case file contains a cookie or authorization value; test this across all pilot cases.
- [ ] Mutants are detected:
  - changing `requireUserId`'s redirect construction;
  - changing the search term passed to the query;
  - inverting the anonymous check.

  A behavior-preserving edit passes.
- [ ] Fixtures cover:
  - an unlisted header read;
  - a request passed by reference to a declared call;
  - a body read replayed from its recording;
  - a request whose cookie the callable reads itself, which privacy rules block.
- [ ] Browser latency stays within budget with the root loader data recorded by `useOptionalUser`. If that data is oversized or sensitive, record the finding and stop rather than adding result projection here.
- [ ] The full gate passes.

## Blocked by

- [03](03-node-tracer-profile-loader.md)
