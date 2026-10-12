# #127: fixed Node retained context identity

Retained, non-production continuation of [staged release](constrained-import-staged-node-results.md),
based on `35b87d1`. The next investigation found a concrete top-level context
identity gap, not a general invalidation or native-qualification solution.

## Why content equality was insufficient

Pinned Vite 8.2.2 constructs an exports object, assigns it both to the module node
and to `context.__vite_ssr_exports__`, and later supplies that context value to
the original evaluator. Primary installed source: `node_modules/vite/dist/node/module-runner.js:1244-1249,1261-1273`;
slot declaration at `:725`, original evaluator consumption at `:1018-1024`.
The driver remeasured the runner SHA-256 as
`c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92`
and the node chunk as
`f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0`.
These are current disk compatibility pins, not loaded-byte provenance.

The previous stager retained descriptor objects, then deep-compared their values.
Replacing the context's exports slot with a new object of the same prototype and
own descriptors passed that comparison. The node's separate exports reference
was untouched, so the existing node identity check also passed. This is precisely
the distinction between equal contents and the retained input object.

The fix compares complete top-level own descriptor keys/fields with `Object.is`
for each retained field. It binds object/function references as well as primitive
values and attribute flags, including symbol keys and data/accessor field shape.
No property getter is invoked to compare its value. Metadata content comparison
is unchanged. This does not freeze nested object contents, closures or prototypes,
and does not qualify arbitrary plugin interference.

## Public control and red/green evidence

Private `stagedControl:'replace-entry-exports'` is accepted only with staged Node
and the already approved evaluator witness enabled. Unknown selectors or use
without those prerequisites refuse before fixture creation. After complete actual
collection, before the final set check/release, the trusted fixture replaces only
the entry context exports slot with an equal-content object. Expected records,
authored source, lowered code and the original late helper mutation are untouched.
This is an interference probe, never an admitted positive or surrogate namespace.
The witness stops before any original evaluator call even with comparison broken.
No original evaluator may run with the replacement control enabled.

The same ordinary HTTP request supplies both controls: unchanged context must
reach `SYNTHETIC_EVALUATOR_DELEGATE_REACHED`; replacement must return
`EVALUATED_INPUT_REFUSED` before that marker. Both successful assertions inspect
zero pending candidates, and both hosts close in `finally`. No new diagnostic,
private-helper assertion, application counter or fabricated recording is added.

The first public test failed in 6,054 ms: replacement reached the marker rather
than refusal. With descriptor identity checks it passed in 11,028 ms. Restoring
only the old content comparison refuted the same replacement assertion in 5,997 ms
(exit one, marker reachable). The identity check was restored immediately.
This makes absence of marker falsifiable; zero candidates alone is not proof of
no delegation, and marker reachability is not original/native execution evidence.

Final regression and independent review evidence belongs in
[the scoped manual ledger](constrained-import-context-identity-gates.md).
Ordinary witness-off 7/8/refusal, inspected explicit review and offline verify
remain separate. Native/transitive provenance, later-demand interference,
general cache/invalidation, browser/replay barriers, full G1B and C2 remain open.
No production PR/merge or effect-policy, eligibility, API, schema, profile,
dependency or application change is selected. #106 stays open; #107 blocked.
