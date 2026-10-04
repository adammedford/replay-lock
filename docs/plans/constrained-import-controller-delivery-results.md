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
- A separate harmless extra HTML document is refused with the existing Vite500
  GRAPH_REFUSED diagnostic and its authored marker is not delivered. Removing the
  identity refusal produces200 and makes that regression fail. This is a route
  control, not an independently latched native-effect oracle.
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
