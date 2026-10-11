# #127: fixed Node staged release

Retained, non-production continuation of the
[release-barrier design](constrained-import-release-barrier-research.md) and
[approved delegate witness](constrained-import-delegate-witness-results.md), based
on `52ca2f9`. This is a two-inline-module fixture barrier, not full G1B or
qualification of the observer's native/transitive executable family.

## Actual input collection

Private `stagedNode:true` requires the existing final Node/sealed/native adapter.
Its separate staging module attaches to Vite's own runner before ordinary entry
import. Expected code remains the separately prepared frozen reference; no actual
output, graph, namespace or cache teaches the preparer.

The collector explicitly calls the preserved original `cachedModule` and
`cachedRequest` for the declared entry, no-edge helper and observer route. The
runner builds its own original contexts and reaches the same actual evaluator
wrapper. The existing downstream helper mutation runs there, then final comparison
runs there; only then is the exact original delegation closure retained behind an
unsettled promise. No original evaluator is called during collection. This changes
when the real helper request reaches its evaluator, not the control's location in
the transform/evaluator chain: it is not applied to preparation copies or expected
records to manufacture parity. Native default plugins remain enabled and ordered.

Entry, helper and external route must all arrive before release. Ordinary requests
cannot borrow an async staging flag: only the collector holds the original request
functions. Canonical nodes, request promises, metadata identity/content, evaluator
methods and top-level context descriptors are checked. Vite's pinned module map
normalizes a native file URL to a physical-path node id while retaining the URL in
fetch metadata; both declarations are bound, and encoded-path ambiguity refuses.

## Retained release and lifecycle

After complete collection, ordinary entry import consumes the retained node. Each
ordinary request activates its exact saved original delegation once, in fixed
entry → observer → helper demand order. There is no speculative release-all,
refetch, mutable-cache reconstruction, second control pass or surrogate namespace.
Vite still supplies original exports, import metadata and imported-name checks.
This no-edge helper restriction does not prove cycles, diamonds, re-exports,
arbitrary initializers or general callstack semantics.

Collection fetches/arrivals, ordinary import and cleanup settlement have private five-second
supervisors; exhaustion is failure/refusal, not successful prevention. Refusal
rejects every retained completion, settles request rejections and retires the
transaction. Ordinary close still runs and clears its original runner. Warm
invocations and alternate HTTP routes remain refused, not newly admitted. Fetch
completion rechecks runner bindings and collecting phase before retaining any node,
so a completion after retirement cannot restart collection. Supervisors bound the
caller/retained promises; they do not cancel arbitrary underlying host fetches or
native operations.

The immutable code strings are retained by closures over the original evaluator
receiver/context/module. Descriptor/metadata checks do **not** freeze nested
objects or closure state. The claim relies on the fixed trusted host, disabled
HMR/watchers, closed client routes, exclusive owned turn and restricted authored
code that cannot access those internal objects. Arbitrary plugin interference,
load-time races and adversarial mutable-context/invalidation coverage are not
established by this slice. Trusted import-meta/context construction can occur
during collection; zero original fixture delegation is not zero infrastructure
effects or a sandbox.

## Public evidence

| Same fixed scenario | Staged ordinary HTTP result |
| --- | --- |
| Unchanged release, witness on | delegate-reached marker |
| Same original late helper mutation, comparison on, witness on | typed `EVALUATED_INPUT_REFUSED`, before marker |
| Same original late helper mutation, comparison off, witness off | 8; one complete unreviewed candidate |
| Same original late helper mutation, comparison on, witness off | typed refusal; zero pending candidates |
| Unchanged release, witness off | 7; inspected complete candidate, explicit review, ordinary offline verify |

The witness test first failed on the original path: guarded helper drift reached
the entry marker rather than refusal. After staging it passed in 11,082 ms.
Natural three-mode release passed in 17,672 ms. Candidate environment, complete
capture, locator, arguments, return completion and trace were inspected; mutated
candidates were never reviewed. All hosts close in `finally`.

Temporarily removing only final code equality refuted the guarded witness case:
the marker became reachable instead of typed refusal (exit one). Temporarily
disabling helper demand activation refuted natural release: HTTP409 instead of200
after bounded timeout, without hanging cleanup (exit one). Independent reviews
identified an unsupervised collection fetch; it is now bounded and revalidates
retirement before retaining a node. A temporary never-arriving helper-fetch control
refuted the unchanged witness case with typed refusal instead of the marker in
5,550 ms (exit one), without hanging cleanup. This public control tests transaction
supervision, not cancellation of a real stalled host operation. All controls were
restored immediately. These controls do not independently prove every metadata
guard or general initialization-order equivalence; fixed demand order is enforced
and source-reviewed, not a newly observed arbitrary-graph property.

After the collection lifecycle repair, restored focused tests passed 2/2 with
zero failures/skips: witness 11,456 ms; natural release 17,518 ms. Both independent
Standards and Spec re-reviews found no remaining actionable findings. Direct
typechecking and syntax checks for all five changed JavaScript files passed;
typechecking does not cover these private JavaScript files.

Unchanged full `npm run verify` exited zero on Node 22.19.0/npm 11.5.2,
including tooling, package contract, packed consumer and locked acceptance with
serial browser checks. Final direct typechecking also passed. No hosted CI claim.

The subsequent standalone affected file passed 10/10, zero failures/skips, in
132,435 ms aggregate. Staged witness: 11,105 ms; natural release: 17,863 ms.
Every test retains the existing 60,000 ms ceiling. Final source audit confirms
all three source refutations restored, no temporary logging, and clean/unchanged
main at `0867957`. The four scoped manual gates are met, zero unmet/abandoned.

Final regression evidence is retained in
[the scoped ledger](constrained-import-staged-node-gates.md). Ordinary offline
verify remains its unchanged adapter; it does not install this private live barrier.
Other platforms refuse/skip the selected native recipe. Browser/replay final
barriers, native loaded-byte/transitive provenance, full lifecycle/cache and C2
diagnostic ordering remain open. #106 stays open, #107 blocked. No production
PR/merge, effect-policy/eligibility/API/schema/profile/dependency/application change.
