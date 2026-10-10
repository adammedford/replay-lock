// Private fixed Node recipe acquisition. Never evaluates application/config.
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const failure = () => new Error('REFERENCE_INPUT_REFUSED');
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

export async function prepareNodeReference(snapshot, finalNode = false) {
  const url = new URL('../dist/dev-options.js', import.meta.url);
  if (createHash('sha256').update(readFileSync(url)).digest('hex') !== 'ec26840491d70107a18ecc97bfef392830b0de3d8a762c4317a55de902938203') throw failure();
  const { resolveDevOptions } = await import(url.href);
  // Fixed fixture declaration, not learned from actual host requests/results.
  const tuple = { environment: 'node', generation: '0000000001', runtimeImport: 'replaylock/dev/runtime',
    options: { ...resolveDevOptions(), resolveAliases: [],
      resolveConditions: { node: ['module', 'node', 'development'], browser: ['module', 'browser', 'development'] } } };
  const worker = new Worker(new URL('./prototype-import-reference-worker.mjs', import.meta.url), {
    execArgv: [`--import=${new URL('./prototype-import-analysis-bootstrap.mjs', import.meta.url).href}`],
    workerData: { root: snapshot.root, environment: 'node', replaylockPrototypeAnalysis: snapshot, referenceTuple: tuple, finalNode },
  });
  let timer;
  try {
    const table = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(failure()), 10000);
      worker.once('error', reject);
      worker.once('exit', () => reject(failure()));
      worker.once('message', value => value?.error ? reject(failure()) : resolve(value));
    });
    if (table.records?.length !== 2 || JSON.stringify(table.tuple) !== JSON.stringify(tuple)) throw failure();
    return freeze(table);
  } finally { clearTimeout(timer); await worker.terminate(); }
}
