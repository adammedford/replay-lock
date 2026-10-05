// Immutable fixture read/probe projection. Never delegates an analysis access.
import { workerData, isMainThread } from 'node:worker_threads';
import { createSnapshotView } from './prototype-import-analysis-view.mjs';
const snapshot = workerData?.replaylockPrototypeAnalysis;
if (isMainThread || !snapshot || snapshot.root !== workerData.root || snapshot.records.length !== 6) throw new Error('ANALYSIS_INPUT_REFUSED');
export const { assertSnapshot, statSync, lstatSync, readFileSync, realpathSync, readdirSync } = createSnapshotView(snapshot);
