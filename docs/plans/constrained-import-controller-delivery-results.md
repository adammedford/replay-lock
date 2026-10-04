# #127: retained fixed-controller HTML delivery

Status: partial retained follow-up to the
[owned-turn slice](constrained-import-owned-turn-results.md), outside main.
Operation-boundary timing, effect permissions, provenance rules, runtime pins and
60000ms test ceilings are unchanged. No application eligibility gain is claimed.

## Gap and placement

The authored application graph already loaded retained strings, but Vite's normal
HTML middleware reread `index.html` before a button could request admission. A
literal-only replacement document was therefore delivered despite qualification
having retained a different fixed trusted controller. The HTTP/browser regression
failed on that actual replacement delivery; no effectful replacement was executed.

The generation plugin now supplies the retained fixed controller from a `pre`
HTML-transform hook before Vite's inline-module extraction. The live hook accepts
only the lexical fixture `index.html` identity and refuses other HTML documents
that reach this transform path. The replay-mode hook does not replace or classify
the normal isolated verifier's generated UI; the existing verifier still owns it.
This is fixed test-infrastructure input binding, not application statement pruning
or a new permission for arbitrary HTML/configuration/plugins.

Installed Vite8.2.2 `dist/node/chunks/node.js` shows the HTML filesystem reread at
25731–25733 and hook ordering at25504–25528: plugin pre-hooks precede
`htmlEnvHook`/`devHtmlHook`, where inline modules are extracted. The built-in
pre-import-map hook is a warning and the fixed fixture has no CSP nonce; no
replacement executable module is extracted before this plugin hook in that route.
These are checked installed-source locations, not portable adapter guarantees.

## Public probes

- Harmless replacement HTML is absent from root, explicit index, queried index and
  encoded index HTTP responses. Each delivers the original controller text.
  A real page reload still shows the original button; its natural click refuses
  GENERATION_CLOSED because admission detects the changed index metadata.
- A separate harmless extra HTML document is refused with fixture409
  GRAPH_REFUSED diagnostic and its authored marker is not delivered. During the
  red control, before adding the HTTP guard, omitting the HTML identity refusal
  produced200 and made that regression fail. This is a route
  control, not an independently latched native-effect oracle.
  The owned HTTP seam refuses other decoded `.html` paths before Vite, whose
  middleware-mode error handler otherwise consumes transform errors before the
  fixture fallback returns404. The explicit refusal has a fixed JSON body; default
  load-only middleware behavior is unchanged. No source text or stack enters that
  HTTP diagnostic. Other fallback/error routes are not generally classified.
- Existing stable positives still require inspected actual complete observations,
  explicit review and ordinary isolated verification. No changed-controller or
  refusal observation is reviewed or accepted.

## Explicit limits

Vite still reads mutable HTML before this hook, so this is not a bounded-read or
atomic source-provider proof for HTML delivery. It is not final transformed-byte
binding: trusted later HTML/module transforms still run. Physical aliases, raw
filesystem delivery, HTML proxies, other extra-entry/native/cache/worker routes,
concurrent delivery and complete fresh-process/browser ownership are not proved.
The hook's lexical identity is not a universal physical-identity defense. No
arbitrary input or application HTML is newly trusted. Complete G1B and mid-turn
observation provenance remain open; #106 remains open and #107 blocked.

## Independent review

### Standards

Four-pass read-only review of `b7453e4...5b6b0d3` found no documented-standard
violations or actionable heuristic findings. It checked installed hook ordering,
fixed diagnostics, existing cleanup and the explicit source/route proof limits.

### Spec

Four-pass read-only review found zero actionable mismatches for this bounded
follow-up. It confirmed fixed infrastructure classification, accepted temporal
semantics, natural public probes and unchanged effect/provenance boundaries.
Both reviews explicitly declined to certify tests or full G1B feasibility.

## Verification

Implementation `baa78e7`, refusal diagnostic correction
`5b6b0d3c0a35df33314e77b4fa86b16a7ac52428`, retained on
`prototype/constrained-import-admission`. Node22.19.0/npm11.5.2 with a writable
temporary npm cache: six owned-turn tests passed; typecheck and diffcheck passed;
the full unweakened `npm run verify` exited0 with `verification suite passed`.
It includes the runner regressions, package contract, packed consumer, every
locked acceptance file and serial Chromium checks. Existing default load-only
failure characterizations passed unchanged in the full suite.

An intermediate three-file focused run was9/10: the non-controller HTML assertion
exposed Vite's middleware404/error-consumption gap. The corrected explicit HTTP
refusal then passed; this failure was not suppressed or removed. Test ceilings
remain60000ms. These checks do not satisfy full G1B or application revalidation.

## Application revalidation limitation

No application/configuration/dependency execution or edits occurred in this
follow-up. Main was rechecked clean at `0867957626ba7a0869fe1fa2753ec311afee60d0`.
The prior pinned temporary application is no longer a usable Git checkout: its
`.git/HEAD`, server entry and `node_modules/@noble/hashes/sha3.js` are absent in the
existing directory. The cause is unknown; this work's edits and fixture cleanup
did not target it. The old application commit/hash/dirty-state preservation claim
cannot be freshly verified. No reconstruction, fetching, dependency installation
or application execution was attempted; older evidence remains historical only.
