// Physical only before activation; after activation no ambient fallback exists.
import * as physical from 'node:fs';
import { replayAnalysisView } from './prototype-import-replay-analysis-state.mjs';
export const statSync = (...args) => (replayAnalysisView() ?? physical).statSync(...args);
export const lstatSync = (...args) => (replayAnalysisView() ?? physical).lstatSync(...args);
export const readFileSync = (...args) => (replayAnalysisView() ?? physical).readFileSync(...args);
export const readdirSync = (...args) => (replayAnalysisView() ?? physical).readdirSync(...args);
export const realpathSync = (...args) => (replayAnalysisView() ?? physical).realpathSync(...args);
realpathSync.native = (...args) => (replayAnalysisView() ?? physical).realpathSync.native(...args);
