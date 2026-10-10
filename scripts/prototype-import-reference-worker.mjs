// RETAINED #127: snapshot-only fixture preparation, not full qualification.
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
  const finalAdapter = workerData.finalNode ? await import('./prototype-import-final-node-recipe.mjs') : undefined;
  const finalRecipe = finalAdapter ? await finalAdapter.acquireFinalNodeRecipe() : undefined;
  const records = [];
  for (const [url, code] of sources) {
    const id = path.join(root, url.slice(1));
    const result = transformDevSource({ ...tuple, root, id, code });
    assertSnapshot();
    const record = { id, authored: code, result: JSON.parse(JSON.stringify(result)) };
    if (finalAdapter) record.final = await finalAdapter.prepareFinalNodeRecord(finalRecipe, url, id, code, record.result);
    records.push(record);
  }
  assertSnapshot();
  parentPort.postMessage({ tuple, records, ...(finalRecipe ? { finalRecipe } : {}) });
} catch { parentPort.postMessage({ error: 'REFERENCE_INPUT_REFUSED' }); }
