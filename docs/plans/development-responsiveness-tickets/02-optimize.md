Parent: #72

Reuse source-file analysis facts, consolidate validated admission and transformation, and remove duplicate invalidation. Preserve diagnostics, generation separation, full reloads, overlays, and filesystem freshness.

Acceptance:
- [ ] Cached and fresh analysis/transform results match across the parent spec edit matrix.
- [ ] Existing public recording/replay and production exclusion tests pass.
- [ ] No public API/schema/runtime compatibility change or watcher-only freshness.

Blocked by: #73.

Published issue: https://github.com/adammedford/replay-lock/issues/74
