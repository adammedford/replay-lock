# #127: actual live-host attachment controls

Status: partial live attachment prerequisite. Baseline
`5a82ee5ddf38e6536d58a4e2993c4767ec158eca`. User Continue follows the approved
fixed pinned recipe/private host evaluation. The prior
[replay attachment controls](constrained-import-evaluated-attachment-results.md)
did not supply a final live Node evaluator. Complete that prerequisite before
claiming recipe qualification or live/replay byte binding.

## Public behavior and red/green controls

Each realm uses three fresh synthetic owned workflows. No application initializer
effect, authored-source mutation, standalone runner or direct target invocation
is added. Ordinary source remains the scalar helper and synchronous result.

| Mode | Natural Node HTTP | Natural Chromium button |
| --- | --- | --- |
| Release | 200, result 7, actual complete observation explicitly reviewed and ordinarily verified | 200 entry response, result 7, actual complete observation explicitly reviewed and ordinarily verified |
| Harmless late mutation | 200, result 8 | 200 entry response, result 8 |
| Explicit entry refusal | 409 EVALUATED_INPUT_REFUSED, no pending candidate | 409 entry response, settled refused UI, independently read typed HTTP refusal, no pending candidate |

Both mutation tests first went red against missing attachments: natural result 7
instead of 8. Mutation and refusal are separate controls. Mutation intentionally
reaches unchecked code, establishing that the actual hook can alter execution;
it is **not qualification refusal**. Its observations are discarded without
review, as are all refusal workflows. Only unchanged result 7 is inspected and
accepted. Existing replay tests retain their original public behavior after the
harmless control logic is shared privately.

An initial runner-attachment attempt failed at normal shutdown: Vite clears its
compatibility runner after closing it. The retained attachment permits that
closed-runner cleanup and refuses replacement/reinitialization. Chromium's
rejected module response exposed an empty body in Playwright, so body inspection
initially failed rather than providing evidence. The final test holds the natural
controller finish request, reads the same owned entry HTTP seam during the active
turn, then continues finish without manufacturing a response or token. Browser
409 and visible refusal are asserted separately from that typed HTTP body.

## Actual per-host attachment

`attachLiveFixtureControls` is fixture-only, installed on a fresh actual Vite
server before listening or any application module request. It checks the fixed
synthetic root/name, Vite 8.2.2 and these installed source SHA256 identities:

- `dist/node/chunks/node.js`:
  `f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0`
- `dist/node/module-runner.js`:
  `c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92`

Installed `chunks/node.js:11837–11867` creates the ordinary SSRCompatModuleRunner
synchronously before instantiateModule awaits the module graph. An accessor on
this owned server captures that assignment and patches **that instance's**
evaluator before application import proceeds. The original evaluator remains the
delegate. No Vite class prototype, process global or dependency file is patched;
no surrogate runner/namespace is installed. The Node control sees the code after
the ordinary SSR transport's decoration and before AsyncFunction execution.
The source hashes guard this version-sensitive ordering assumption, not arbitrary
filesystem/package mutation or a complete transform trust inventory.

The client control wraps the real client environment transformRequest result.
Release/mutation retain normal Vite HTTP delivery. In refusal mode, the fixture's
owned entry HTTP handler exercises that actual hook before Vite middleware can
consume the thrown refusal into a generic page, and returns only fixed JSON409.
The browser's module fetch cannot execute that withheld entry. This does not bind
exact response bytes after later decoration or cover 304/direct browser caches.

## What is still not proved

These controls plus the prior replay controls establish controllable cold inline
application points in the actual hosts; they do not complete the original
both-host **execution-route coverage** gate. External/native/builtin/data/virtual
routes, warm evaluator-promise/cache reuse, extra entries, worker/service-worker
paths and full host lifecycle ownership remain unqualified. No native-effect
oracle or whole-closure initialization witness is supplied by result 8 or absence
of a candidate. A selected refusal mode is not drift detection or byte equality.

The finite trusted transform recipe still needs independent reconstruction and
whole-closure qualification before application evaluation. Live recording uses
`src/dev-server.ts:343`'s authored transform and generated observer runtime;
ordinary replay uses its own `src/dev-verify.ts:223` plugin/aliases plus Vitest
rewrites and transport decoration. A raw-source digest, final plugin transform,
same-pipeline self-reference, hard-coded result or stripped metadata is not a
valid substitute. Source maps/URLs/recording infrastructure facts must have a
finite trusted classification rather than become ignored application output.

Next retain an independently prepared finite recipe reference from the qualified
authored snapshot and explicit trusted inventory, then compare/withhold exact
realm-specific executable representations at these actual hooks. Preserve the
independent mutation-positive controls and require qualification refusal for late
output drift before claiming binding. Bound each representation separately; test
unknown dependencies, identity drift and cold/warm routes. No arbitrary plugin
or application configuration may run to generate that reference.

Full G1B stays unmet, #106 open and #107 blocked. Effect permissions, operation-
boundary timing, artifact/profile/schema contracts and production interfaces are
unchanged. No production PR/merge, eligibility expansion, pinned application
restoration/execution or dependency edit. The prior incomplete application
revalidation limitation remains unresolved, not an unchanged-baseline claim.

## Verification

Runtime/test pin: `224cd5d`. Node 22.19.0/npm 11.5.2 with the writable fixture cache:

- Complete owned-turn file: 10/10 passed during implementation.
- Current focused live/replay attachment controls: 4/4 passed after shared-control
  and test cleanup; both new live tests retain 60000ms ceilings.
- `npm run typecheck`: passed. JavaScript prototypes are not TypeScript-checked.
- Full unweakened `npm run verify`: exit 0, verification suite passed, including
  coverage/runner regressions, package contract, packed consumer and all locked
  acceptance files with serial browser execution. No test/manifest was removed.
- `git diff --check`: passed.

Post-full-suite driver recheck of both new live controls: 2/2 passed. Results are
local to this POSIX checkout; Windows/path portability is not independently
qualified. No hosted CI pass is claimed: CI runs for main pushes and PRs, not this
retained prototype push, and no production PR was created.

Independent four-pass Standards review of `5a82ee5...224cd5d`: zero documented-
standard violations or actionable smell findings. Independent four-pass Spec
review: zero actionable mismatches for the bounded live attachment prerequisite.
Both explicitly leave the larger execution-route and G1B proof incomplete. Driver
reread both reports and actual Vite assignment, evaluator and cleanup paths;
these source reviews do not independently certify runtime/native-effect coverage.

Primary main remains clean at `0867957626ba7a0869fe1fa2753ec311afee60d0`.
Runtime/test files remain unchanged since the reviewed pin. No pinned application
inspection/restoration/execution or dependency/public API/artifact edit occurred.
