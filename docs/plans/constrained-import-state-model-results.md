# #127: admission ordering logic demo

Retained HTML: [standalone state demo](../../scripts/prototype-import-recipe-state.html).
Initial artifact baseline `6adaacaa20dab01a86d7a632d8b2e6cc1e63080b`.
Open the single HTML file directly; no server, dependency installation or persistence.
This follows the explicitly selected prototype skill's logic workflow, not a
production implementation or real-host qualification experiment.

## Question and bounded answer

Does the proposed state model make late host-output changes and swallowed
refusals terminal before modeled application start?

The browser-driven model exhibits that ordering: a successful early comparison
does not permit changed output at release; a caught/ignored refusal does not
restore authority. Equality alone is not permission. The first refusal reason
is now retained after later clicks rather than replaced by generic latch text.
The new warm-reuse walkthrough contrasts two unchanged retained turns with the
existing edit-during-turn scenario: the old admitted view finishes, but the next
admission after physical drift closes.

These are observations of an explicitly simulated policy, not proof that the
real hosts can provide the required independent representations or boundaries.
The reference and host representation share a toy builder. Realm selection
changes modeled identity; it does not launch four actual application hosts.
No user acceptance or production design decision is inferred from these clicks.

## Click-through observations

A one-off fresh headless Chromium session opened the local file and drove the
rendered buttons. No test file, regression suite, application artifact or real
recording was added. All seven walkthroughs ran in each of the four modeled
realms: live Node, live browser, replay Node and replay browser (28 combinations).
The full relevant state was read from the displayed labelled panel.

| Walkthrough | Displayed end state in each modeled realm |
| --- | --- |
| Clean release | Released; one modeled start; result 7; no refusal |
| Warm reuse | Released; two modeled starts; result 7; no refusal |
| Late output change | Closed at final comparison; zero modeled starts |
| Swallowed refusal | Closed; original unknown-input refusal retained; zero starts |
| Physical drift | Closed; physical-check/seal revision mismatch; zero starts |
| Retained turn | One old-view start returning 7, then next admission closes |
| Later preflight | Closed; later preflight refuses; zero starts |

Free-play reset cleared authority, the refusal reason, history and modeled start
count. Changing the host recipe after a successful comparison kept code unchanged
but refused final release, with zero modeled starts. A final swallowed-refusal
rerun confirmed the panel says matching output still cannot override refusal.

No page errors were reported in the full click-through. Desktop and mobile
screenshots were visually inspected. At a 390px viewport, measured document width
was also 390px; controls and state wrapped without horizontal clipping. This is
local Chromium presentation evidence, not broad browser/accessibility coverage.
Screenshots are disposable local previews, not committed application evidence.

## What remains unanswered

Actual independent compiler reference construction, complete source/configuration
and transitive recipe ownership, exact Node/Vitest/browser code/maps/wire-byte
binding, native/cache/extra-entry routes, lifecycle and provenance remain unproved.
The existing C2 diagnostic handoff is unchanged. No native effect sentinel or
application target was executed to produce a recording. Full G1B remains unmet.

No production reducer or adapter is promoted from this demo. No package, API,
schema, runtime profile, effect permission or production source changes. The
selected prototype workflow adds no automated tests; production typecheck/full
verification were not rerun and their historical results are not renewed here.
Only the throwaway HTML and this observation record change, outside main.
