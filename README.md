# ReplayLock

ReplayLock turns developer-selected calls that already occur in Vitest into explicitly reviewed characterization cases. Issue 2 implements the first narrow tracer bullet: directly exported synchronous leaf functions with finite-number arguments and a finite-number return.

```ts
/** @replaylock capture */
export function total(left: number, right: number): number {
  return left + right;
}
```

Register the integration in `vitest.config.ts`:

```ts
import { replaylock } from "replaylock/vite";

export default {
  plugins: [replaylock()],
};
```

Then run the three-step workflow:

```text
replaylock record -- vitest run
replaylock review
replaylock verify
```

Recording never calls the selected function on its own. Review requires an explicit acceptance before ReplayLock writes a deterministic JSON case under `.replaylock/cases`. Verification consumes that artifact through a disposable fresh Vitest test and never creates a source test per case.

This tracer bullet deliberately does not claim general JavaScript purity, broad value support, or the safety behavior assigned to later V1 tickets.
