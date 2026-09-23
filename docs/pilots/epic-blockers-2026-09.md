# Development capture blockers: epic-stack-template

Generated 2026-09-23 with `npm run yield:dev -- --blockers` (catalog 4, ReplayLock 7bf4731) for epic-stack-template at `8473afd`.

Unlock counts are upper bounds: analysis records one origin per reason code per callable, so resolving a site can reveal another site with the same code. Callables with `UNSUPPORTED_CALLABLE` or `UNSUPPORTED_ASYNC` (components, classes, generators, async functions) are outside supported shapes and excluded from the plan. A blocker is *inherited* when its root is reached through a callee, import or initializer rather than the callable's own body.

## node

| Eligible | Skipped | Outside shapes | Blocked in own body | Inherited only |
|---|---|---|---|---|
| 19 | 308 | 232 | 45 | 31 |

### Unlock plan

| Step | Resolve | Unlocks | Cumulative | Examples |
|---|---|---|---|---|
| 1 | `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs | 4 | 4 | app/routes/_auth/signup.tsx#meta, app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile, app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId |
| 2 | `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24 | 3 | 7 | app/root.tsx#meta, app/routes/_auth/forgot-password.tsx#meta, app/routes/users/$username/notes/$noteId.tsx#meta |
| 3 | `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9 | 3 | 10 | app/routes/_auth/login.tsx#meta, app/routes/_auth/onboarding/$provider.tsx#meta, app/routes/_auth/onboarding/index.tsx#meta |
| 4 | `EFFECTFUL_INITIALIZATION` @ pkg:execa | 2 | 12 | remix.init/index.mjs#escapeRegExp, remix.init/index.mjs#getEpicStackVersion |
| 5 | `EFFECTFUL_INITIALIZATION` @ pkg:@sentry/node | 1 | 13 | app/routes/users/$username/index.tsx#meta |
| 6 | `EFFECTFUL_INITIALIZATION` @ app/utils/verification.server.ts:10 | 1 | 14 | app/routes/_auth/reset-password.tsx#meta |
| 7 | `EFFECTFUL_INITIALIZATION` @ server/index.ts:161 | 1 | 15 | server/index.ts#getHost |
| 8 | `FUNCTION_VALUE` @ app/utils/misc.tsx:194 | 1 | 16 | app/utils/misc.tsx#callAll |
| 9 | `FUNCTION_VALUE` @ app/utils/misc.tsx:247 | 1 | 17 | app/utils/misc.tsx#debounce |
| 10 | `FUNCTION_VALUE` @ app/utils/timing.server.ts:29 | 1 | 18 | app/utils/timing.server.ts#createTimer |
| 11 | `FUNCTION_VALUE` @ app/utils/timing.server.ts:98 | 1 | 19 | app/utils/timing.server.ts#cachifiedTimingReporter |
| 12 | `UNKNOWN_CALL` @ app/routes/_auth/verify.server.ts:50 | 1 | 20 | app/routes/_auth/verify.server.ts#getRedirectToUrl |
| 13 | `UNKNOWN_CALL` @ app/routes/_seo/robots[.]txt.ts:6 | 1 | 21 | app/routes/_seo/robots[.]txt.ts#loader |
| 14 | `UNKNOWN_CALL` @ app/routes/_seo/sitemap[.]xml.ts:8 | 1 | 22 | app/routes/_seo/sitemap[.]xml.ts#loader |
| 15 | `UNKNOWN_CALL` @ app/utils/auth.server.ts:261 | 1 | 23 | app/utils/auth.server.ts#getPasswordHashParts |

### Top root sites

| Code | Site | Callables | Only blocker | Examples |
|---|---|---|---|---|
| `ARGUMENT_MUTATION` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:963 | 77 | 0 | app/root.tsx#loader, app/routes/_auth/auth.$provider/callback.ts#loader, app/routes/_auth/auth.$provider/callback.ts#makeSession |
| `UNSUPPORTED_CALLABLE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:958 | 67 | 0 | app/root.tsx#loader, app/routes/_auth/auth.$provider/callback.ts#loader, app/routes/_auth/auth.$provider/callback.ts#makeSession |
| `EFFECTFUL_INITIALIZATION` | app/utils/toast.server.ts:24<br>`secrets: process.env.SESSION_SECRET.split(','),` | 52 | 3 | app/root.tsx#App, app/root.tsx#AppWithProviders, app/root.tsx#Document |
| `UNKNOWN_REFERENCE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:965 | 45 | 0 | app/routes/_auth/auth.$provider/index.ts#loader, app/routes/_auth/login.server.ts#handleNewSession, app/routes/_auth/login.server.ts#shouldRequestTwoFA |
| `EFFECTFUL_INITIALIZATION` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:10235 | 36 | 0 | app/components/error-boundary.tsx#GeneralErrorBoundary, app/components/progress-bar.tsx#EpicProgress, app/components/search-bar.tsx#SearchBar |
| `EFFECTFUL_INITIALIZATION` | app/utils/session.server.ts:9<br>`secrets: process.env.SESSION_SECRET.split(','),` | 31 | 3 | app/routes/_auth/login.server.ts#handleNewSession, app/routes/_auth/login.server.ts#handleVerification, app/routes/_auth/login.server.ts#shouldRequestTwoFA |
| `UNKNOWN_CALL` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:6365 | 28 | 0 | app/root.tsx#App, app/root.tsx#AppWithProviders, app/routes/$.tsx#ErrorBoundary |
| `EFFECTFUL_INITIALIZATION` | pkg:bcryptjs<br>node_modules/bcryptjs/index.js:338 | 26 | 4 | app/routes/_auth/signup.tsx#ErrorBoundary, app/routes/_auth/signup.tsx#SignupEmail, app/routes/_auth/signup.tsx#meta |
| `CLOSURE_CAPTURE` | pkg:@conform-to/dom<br>node_modules/@conform-to/dom/dist/submission.mjs:87 | 22 | 0 | app/root.tsx#App, app/root.tsx#Layout, app/routes/_auth/forgot-password.tsx#action |
| `AMBIENT_MUTATION` | pkg:@conform-to/dom<br>node_modules/@conform-to/dom/dist/submission.mjs:31 | 20 | 0 | app/root.tsx#App, app/root.tsx#Layout, app/routes/_auth/forgot-password.tsx#action |
| `UNKNOWN_CALL` | app/utils/misc.tsx:61<br>`return twMerge(clsx(inputs))` | 19 | 0 | app/components/ui/checkbox.tsx#Checkbox, app/components/ui/dropdown-menu.tsx#DropdownMenuCheckboxItem, app/components/ui/dropdown-menu.tsx#DropdownMenuContent |
| `EFFECTFUL_INITIALIZATION` | app/utils/auth.server.ts:23<br>`const strategy = provider.getAuthStrategy()` | 16 | 0 | app/routes/_auth/logout.tsx#action, app/routes/_auth/signup.tsx#loader, app/routes/_auth/webauthn/registration.ts#action |
| `UNKNOWN_MODULE` | pkg:@conform-to/react<br>node_modules/@conform-to/react/dist/hooks.mjs:35 | 15 | 0 | app/routes/_auth/forgot-password.tsx#ForgotPasswordRoute, app/routes/_auth/login.tsx#LoginPage, app/routes/_auth/onboarding/$provider.tsx#OnboardingProviderRoute |
| `ARGUMENT_MUTATION` | pkg:@conform-to/zod<br>node_modules/@conform-to/zod/dist/default/constraint.mjs:8 | 14 | 0 | app/routes/_auth/forgot-password.tsx#ForgotPasswordRoute, app/routes/_auth/login.tsx#LoginPage, app/routes/_auth/onboarding/$provider.tsx#OnboardingProviderRoute |
| `EFFECTFUL_INITIALIZATION` | pkg:@radix-ui/react-dropdown-menu<br>node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:15 | 14 | 0 | app/components/ui/dropdown-menu.tsx#DropdownMenu, app/components/ui/dropdown-menu.tsx#DropdownMenuCheckboxItem, app/components/ui/dropdown-menu.tsx#DropdownMenuContent |
| `UNKNOWN_REFERENCE` | pkg:@epic-web/invariant<br>node_modules/@epic-web/invariant/dist/index.js:45 | 11 | 0 | app/routes/admin/cache/index.tsx#action, app/routes/resources/theme-switch.tsx#action, app/routes/settings/profile/_layout.tsx#loader |
| `AMBIENT_STATE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:6322 | 10 | 0 | app/root.tsx#AppWithProviders, app/routes/$.tsx#ErrorBoundary, app/utils/client-hints.tsx#useHints |
| `UNINSTRUMENTED_EFFECT` | pkg:litefs-js<br>node_modules/litefs-js/dist/index.js:32 | 10 | 0 | app/entry.server.tsx#handleDataRequest, app/entry.server.tsx#handleRequest, app/routes/_auth/auth.$provider/callback.ts#loader |
| `UNKNOWN_REFERENCE` | pkg:clsx<br>node_modules/clsx/dist/clsx.mjs:1 | 10 | 0 | app/components/ui/button.tsx#Button, app/components/ui/dropdown-menu.tsx#DropdownMenuContent, app/components/ui/dropdown-menu.tsx#DropdownMenuItem |
| `EFFECTFUL_INITIALIZATION` | pkg:execa<br>node_modules/execa/lib/ipc/graceful.js:72 | 9 | 2 | remix.init/index.mjs#ensureLoggedIn, remix.init/index.mjs#escapeRegExp, remix.init/index.mjs#getEpicStackVersion |

### Near misses (40)

- `app/root.tsx#links`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24; `UNKNOWN_MODULE` @ app/root.tsx:47
- `app/root.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/routes/_auth/forgot-password.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/routes/_auth/login.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/onboarding/$provider.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/onboarding/index.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/reset-password.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/verification.server.ts:10
- `app/routes/_auth/signup.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/_auth/verify.server.ts#getRedirectToUrl`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24; `UNKNOWN_CALL` @ app/routes/_auth/verify.server.ts:50
- `app/routes/_seo/robots[.]txt.ts#loader`: `UNKNOWN_CALL` @ app/routes/_seo/robots[.]txt.ts:6
- `app/routes/_seo/sitemap[.]xml.ts#loader`: `UNKNOWN_CALL` @ app/routes/_seo/sitemap[.]xml.ts:8
- `app/routes/users/$username/index.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ pkg:@sentry/node
- `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/users/$username/notes/$noteId.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/utils/auth.server.ts#getPasswordHashParts`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs; `UNKNOWN_CALL` @ app/utils/auth.server.ts:261
- `app/utils/auth.server.ts#getSessionExpirationDate`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/utils/cache.server.ts#bufferReviver`: `UNKNOWN_CALL` @ app/utils/cache.server.ts:112; `UNKNOWN_REFERENCE` @ app/utils/cache.server.ts:112
- `app/utils/env.server.ts#getEnv`: `AMBIENT_STATE` @ app/utils/env.server.ts:61; `ENVIRONMENT_DEPENDENCE` @ app/utils/env.server.ts:61
- `app/utils/misc.tsx#callAll`: `FUNCTION_VALUE` @ app/utils/misc.tsx:194
- … 20 more (see `--json`)

## browser

| Eligible | Skipped | Outside shapes | Blocked in own body | Inherited only |
|---|---|---|---|---|
| 19 | 308 | 232 | 45 | 31 |

### Unlock plan

| Step | Resolve | Unlocks | Cumulative | Examples |
|---|---|---|---|---|
| 1 | `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs | 4 | 4 | app/routes/_auth/signup.tsx#meta, app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile, app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId |
| 2 | `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24 | 3 | 7 | app/root.tsx#meta, app/routes/_auth/forgot-password.tsx#meta, app/routes/users/$username/notes/$noteId.tsx#meta |
| 3 | `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9 | 3 | 10 | app/routes/_auth/login.tsx#meta, app/routes/_auth/onboarding/$provider.tsx#meta, app/routes/_auth/onboarding/index.tsx#meta |
| 4 | `EFFECTFUL_INITIALIZATION` @ pkg:execa | 2 | 12 | remix.init/index.mjs#escapeRegExp, remix.init/index.mjs#getEpicStackVersion |
| 5 | `EFFECTFUL_INITIALIZATION` @ pkg:@sentry-internal/replay | 1 | 13 | app/routes/users/$username/index.tsx#meta |
| 6 | `EFFECTFUL_INITIALIZATION` @ app/utils/verification.server.ts:10 | 1 | 14 | app/routes/_auth/reset-password.tsx#meta |
| 7 | `EFFECTFUL_INITIALIZATION` @ server/index.ts:161 | 1 | 15 | server/index.ts#getHost |
| 8 | `FUNCTION_VALUE` @ app/utils/misc.tsx:194 | 1 | 16 | app/utils/misc.tsx#callAll |
| 9 | `FUNCTION_VALUE` @ app/utils/misc.tsx:247 | 1 | 17 | app/utils/misc.tsx#debounce |
| 10 | `FUNCTION_VALUE` @ app/utils/timing.server.ts:29 | 1 | 18 | app/utils/timing.server.ts#createTimer |
| 11 | `FUNCTION_VALUE` @ app/utils/timing.server.ts:98 | 1 | 19 | app/utils/timing.server.ts#cachifiedTimingReporter |
| 12 | `UNKNOWN_CALL` @ app/routes/_auth/verify.server.ts:50 | 1 | 20 | app/routes/_auth/verify.server.ts#getRedirectToUrl |
| 13 | `UNKNOWN_CALL` @ app/routes/_seo/robots[.]txt.ts:6 | 1 | 21 | app/routes/_seo/robots[.]txt.ts#loader |
| 14 | `UNKNOWN_CALL` @ app/routes/_seo/sitemap[.]xml.ts:8 | 1 | 22 | app/routes/_seo/sitemap[.]xml.ts#loader |
| 15 | `UNKNOWN_CALL` @ app/utils/auth.server.ts:261 | 1 | 23 | app/utils/auth.server.ts#getPasswordHashParts |

### Top root sites

| Code | Site | Callables | Only blocker | Examples |
|---|---|---|---|---|
| `ARGUMENT_MUTATION` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:963 | 77 | 0 | app/root.tsx#loader, app/routes/_auth/auth.$provider/callback.ts#loader, app/routes/_auth/auth.$provider/callback.ts#makeSession |
| `UNSUPPORTED_CALLABLE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:958 | 67 | 0 | app/root.tsx#loader, app/routes/_auth/auth.$provider/callback.ts#loader, app/routes/_auth/auth.$provider/callback.ts#makeSession |
| `EFFECTFUL_INITIALIZATION` | app/utils/toast.server.ts:24<br>`secrets: process.env.SESSION_SECRET.split(','),` | 52 | 3 | app/root.tsx#App, app/root.tsx#AppWithProviders, app/root.tsx#Document |
| `UNKNOWN_REFERENCE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:965 | 45 | 0 | app/routes/_auth/auth.$provider/index.ts#loader, app/routes/_auth/login.server.ts#handleNewSession, app/routes/_auth/login.server.ts#shouldRequestTwoFA |
| `EFFECTFUL_INITIALIZATION` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:10235 | 36 | 0 | app/components/error-boundary.tsx#GeneralErrorBoundary, app/components/progress-bar.tsx#EpicProgress, app/components/search-bar.tsx#SearchBar |
| `EFFECTFUL_INITIALIZATION` | app/utils/session.server.ts:9<br>`secrets: process.env.SESSION_SECRET.split(','),` | 31 | 3 | app/routes/_auth/login.server.ts#handleNewSession, app/routes/_auth/login.server.ts#handleVerification, app/routes/_auth/login.server.ts#shouldRequestTwoFA |
| `UNKNOWN_CALL` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:6365 | 28 | 0 | app/root.tsx#App, app/root.tsx#AppWithProviders, app/routes/$.tsx#ErrorBoundary |
| `EFFECTFUL_INITIALIZATION` | pkg:bcryptjs<br>node_modules/bcryptjs/index.js:338 | 26 | 4 | app/routes/_auth/signup.tsx#ErrorBoundary, app/routes/_auth/signup.tsx#SignupEmail, app/routes/_auth/signup.tsx#meta |
| `CLOSURE_CAPTURE` | pkg:@conform-to/dom<br>node_modules/@conform-to/dom/dist/submission.mjs:87 | 22 | 0 | app/root.tsx#App, app/root.tsx#Layout, app/routes/_auth/forgot-password.tsx#action |
| `AMBIENT_MUTATION` | pkg:@conform-to/dom<br>node_modules/@conform-to/dom/dist/submission.mjs:31 | 20 | 0 | app/root.tsx#App, app/root.tsx#Layout, app/routes/_auth/forgot-password.tsx#action |
| `UNKNOWN_CALL` | app/utils/misc.tsx:61<br>`return twMerge(clsx(inputs))` | 19 | 0 | app/components/ui/checkbox.tsx#Checkbox, app/components/ui/dropdown-menu.tsx#DropdownMenuCheckboxItem, app/components/ui/dropdown-menu.tsx#DropdownMenuContent |
| `EFFECTFUL_INITIALIZATION` | app/utils/auth.server.ts:23<br>`const strategy = provider.getAuthStrategy()` | 16 | 0 | app/routes/_auth/logout.tsx#action, app/routes/_auth/signup.tsx#loader, app/routes/_auth/webauthn/registration.ts#action |
| `UNKNOWN_MODULE` | pkg:@conform-to/react<br>node_modules/@conform-to/react/dist/hooks.mjs:35 | 15 | 0 | app/routes/_auth/forgot-password.tsx#ForgotPasswordRoute, app/routes/_auth/login.tsx#LoginPage, app/routes/_auth/onboarding/$provider.tsx#OnboardingProviderRoute |
| `ARGUMENT_MUTATION` | pkg:@conform-to/zod<br>node_modules/@conform-to/zod/dist/default/constraint.mjs:8 | 14 | 0 | app/routes/_auth/forgot-password.tsx#ForgotPasswordRoute, app/routes/_auth/login.tsx#LoginPage, app/routes/_auth/onboarding/$provider.tsx#OnboardingProviderRoute |
| `EFFECTFUL_INITIALIZATION` | pkg:@radix-ui/react-dropdown-menu<br>node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:15 | 14 | 0 | app/components/ui/dropdown-menu.tsx#DropdownMenu, app/components/ui/dropdown-menu.tsx#DropdownMenuCheckboxItem, app/components/ui/dropdown-menu.tsx#DropdownMenuContent |
| `UNKNOWN_REFERENCE` | pkg:@epic-web/invariant<br>node_modules/@epic-web/invariant/dist/index.js:45 | 11 | 0 | app/routes/admin/cache/index.tsx#action, app/routes/resources/theme-switch.tsx#action, app/routes/settings/profile/_layout.tsx#loader |
| `AMBIENT_STATE` | pkg:react-router<br>node_modules/react-router/dist/development/chunk-QUQL4437.mjs:6322 | 10 | 0 | app/root.tsx#AppWithProviders, app/routes/$.tsx#ErrorBoundary, app/utils/client-hints.tsx#useHints |
| `UNKNOWN_REFERENCE` | pkg:clsx<br>node_modules/clsx/dist/clsx.mjs:1 | 10 | 0 | app/components/ui/button.tsx#Button, app/components/ui/dropdown-menu.tsx#DropdownMenuContent, app/components/ui/dropdown-menu.tsx#DropdownMenuItem |
| `EFFECTFUL_INITIALIZATION` | pkg:execa<br>node_modules/execa/lib/ipc/graceful.js:72 | 9 | 2 | remix.init/index.mjs#ensureLoggedIn, remix.init/index.mjs#escapeRegExp, remix.init/index.mjs#getEpicStackVersion |
| `EFFECTFUL_INITIALIZATION` | app/utils/verification.server.ts:10<br>`secrets: process.env.SESSION_SECRET.split(','),` | 9 | 1 | app/routes/_auth/onboarding/$provider.server.ts#handleVerification, app/routes/_auth/onboarding/index.server.ts#handleVerification, app/routes/_auth/reset-password.server.ts#handleVerification |

### Near misses (40)

- `app/root.tsx#links`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24; `UNKNOWN_MODULE` @ app/root.tsx:47
- `app/root.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/routes/_auth/forgot-password.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/routes/_auth/login.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/onboarding/$provider.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/onboarding/index.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/session.server.ts:9
- `app/routes/_auth/reset-password.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/verification.server.ts:10
- `app/routes/_auth/signup.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/_auth/verify.server.ts#getRedirectToUrl`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24; `UNKNOWN_CALL` @ app/routes/_auth/verify.server.ts:50
- `app/routes/_seo/robots[.]txt.ts#loader`: `UNKNOWN_CALL` @ app/routes/_seo/robots[.]txt.ts:6
- `app/routes/_seo/sitemap[.]xml.ts#loader`: `UNKNOWN_CALL` @ app/routes/_seo/sitemap[.]xml.ts:8
- `app/routes/users/$username/index.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ pkg:@sentry-internal/replay
- `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/routes/users/$username/notes/$noteId.tsx#meta`: `EFFECTFUL_INITIALIZATION` @ app/utils/toast.server.ts:24
- `app/utils/auth.server.ts#getPasswordHashParts`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs; `UNKNOWN_CALL` @ app/utils/auth.server.ts:261
- `app/utils/auth.server.ts#getSessionExpirationDate`: `EFFECTFUL_INITIALIZATION` @ pkg:bcryptjs
- `app/utils/cache.server.ts#bufferReviver`: `UNKNOWN_CALL` @ app/utils/cache.server.ts:112; `UNKNOWN_REFERENCE` @ app/utils/cache.server.ts:112
- `app/utils/env.server.ts#getEnv`: `AMBIENT_STATE` @ app/utils/env.server.ts:61; `ENVIRONMENT_DEPENDENCE` @ app/utils/env.server.ts:61
- `app/utils/misc.tsx#callAll`: `FUNCTION_VALUE` @ app/utils/misc.tsx:194
- … 20 more (see `--json`)
