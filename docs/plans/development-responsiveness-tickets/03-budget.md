Parent: #72

Run five alternating recording-enabled/disabled browser pairs on the final optimized build. Require added medians <=2000ms cold page, <=100ms navigation, <=2000ms visible update. Verify source, artifact and runner identities and automatic cleanup.

Acceptance:
- [ ] All ten trials complete with raw samples and cleanup evidence.
- [ ] All three agreed budgets pass without relaxing thresholds.
- [ ] Full local verification, dogfood, and hosted CI pass.
- [ ] Historical evidence is preserved; any unmet outcome remains explicit.

Blocked by: #74.

Published issue: https://github.com/adammedford/replay-lock/issues/75
