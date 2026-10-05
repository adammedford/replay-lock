// Process-local, one-way phase transition. Physical preflight is never sealed.
import { captureFixtureAnalysis } from './prototype-import-analysis-bootstrap.mjs';
import { createSnapshotView } from './prototype-import-analysis-view.mjs';
import { qualifyPlacementSources } from './prototype-import-placement.mjs';

let view, started = false, refused = false;
const fail = () => { refused = true; throw new Error('REPLAY_ANALYSIS_REFUSED'); };
export function assertPhysicalPreflight() { if (started || refused) fail(); }
export function replayAnalysisView() { if (refused || (started && !view)) fail(); return view; }
export function assertReplayAnalysis() { if (refused) fail(); if (started) { if (!view) fail(); view.assertSnapshot(); } }
export function beginReplayAnalysis(root, phase) {
  if (phase === 'validate') { assertPhysicalPreflight(); return; }
  if (phase !== 'replay' || started || root !== process.env.REPLAYLOCK_PROTOTYPE_ANALYSIS_ROOT) fail();
  started = true;
  if (process.env.REPLAYLOCK_PROTOTYPE_ANALYSIS_MODE !== 'release') fail();
  try {
    const { snapshot, current } = captureFixtureAnalysis(root);
    const sources = new Map(snapshot.records.filter(record => record.name.endsWith('.mjs') && record.name !== 'vite.config.mjs')
      .map(record => ['/' + record.name, record.text]));
    const closure = qualifyPlacementSources(sources);
    if (closure.length !== sources.size || !current()) fail();
    view = createSnapshotView(snapshot, 'REPLAY_ANALYSIS_REFUSED');
  } catch { fail(); }
}
