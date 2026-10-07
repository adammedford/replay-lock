// RETAINED #127: snapshot-only instrumentation, not executable qualification.
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { assertSnapshot } from './prototype-import-analysis-fs.mjs';
import { placementDependencies, qualifyPlacementSources } from './prototype-import-placement.mjs';

try {
  const { root, replaylockPrototypeAnalysis: snapshot, referenceTuple: tuple } = workerData;
  const sources = new Map(snapshot.records.filter(record => ['entry.mjs', 'helper.mjs'].includes(record.name))
    .map(record => ['/' + record.name, record.text]));
  qualifyPlacementSources(sources);
  if (sources.size !== 2 || placementDependencies(sources.get('/entry.mjs'), '/entry.mjs').join() !== '/helper.mjs'
    || placementDependencies(sources.get('/helper.mjs'), '/helper.mjs').length) throw new Error('REFERENCE_INPUT_REFUSED');
  // This worker receives no actual host cache, outputs, graph or namespace.
  const { transformDevSource } = await import('../dist/dev-transform.js');
  const records = [...sources].map(([url, code]) => {
    const id = path.join(root, url.slice(1));
    const result = transformDevSource({ ...tuple, root, id, code });
    assertSnapshot();
    return { id, authored: code, result: JSON.parse(JSON.stringify(result)) };
  });
  assertSnapshot();
  parentPort.postMessage({ tuple, records });
} catch { parentPort.postMessage({ error: 'REFERENCE_INPUT_REFUSED' }); }
