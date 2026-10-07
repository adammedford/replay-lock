import { Worker as NativeWorker } from 'node:worker_threads';
import { snapshots, references } from './prototype-import-analysis-bootstrap.mjs';

export class Worker extends NativeWorker {
  constructor(filename, options) {
    const snapshot = snapshots.get(options?.workerData?.root);
    if (snapshot) {
      if (!(filename instanceof URL) || filename.href !== new URL('../dist/dev-analysis-worker.js', import.meta.url).href
        || !['node', 'browser'].includes(options.workerData.environment)
        || !Array.isArray(options.execArgv) || options.workerData.replaylockPrototypeAnalysis) throw new Error('ANALYSIS_INPUT_REFUSED');
      options = { ...options, execArgv: [...options.execArgv, `--import=${new URL('./prototype-import-analysis-bootstrap.mjs', import.meta.url).href}`],
        workerData: { ...options.workerData, replaylockPrototypeAnalysis: snapshot,
          ...(options.workerData.environment === 'node' && references.has(snapshot.root)
            ? { replaylockPrototypeReference: references.get(snapshot.root) } : {}) } };
    }
    super(filename, options);
  }
}
