// RETAINED #127: install before dynamically importing the ordinary fixture host.
// Private live-worker input experiment, NOT replay or executable qualification.
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { realpathSync, readdirSync, statSync, openSync, readSync, fstatSync, closeSync, constants } from 'node:fs';
import path from 'node:path';
import { isMainThread, workerData } from 'node:worker_threads';

const failure = () => new Error('ANALYSIS_INPUT_REFUSED');
let clientInstalled = false;
const pins = new Map([
  ['dev-analysis-client', '856070b08826df756297c751e5895dfc25944891ae02feb29345a17d0ca2e88a'],
  ['dev-analysis-worker', 'f49a1be94ae628378a2b34f3398b8841c903725763b7672e4e25a59608d72258'],
  ['dev-analysis', '009661e49beee0b24771a062b7743457cf9268675bc77c1f868cb796493dbdc1'],
  ['dev-project-cache', 'cc61421424a0fc7768cebd8c5100b66d69159908676925e4612d172366899e9a'],
  ['dev-transform', '7cbee4185d385d8bc48376ed02649bc202c8595c1355fda54866078d84dc9675'],
].map(([name, digest]) => [new URL(`../dist/${name}.js`, import.meta.url).href, digest]));
export const snapshots = new Map();
const files = ['entry.mjs', 'helper.mjs', 'index.html', 'package.json', 'package-lock.json', 'vite.config.mjs'];
const fields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'];
const identity = stats => fields.map(key => stats[key]).join(':');
const statsRecord = stats => Object.fromEntries(fields.map(key => [key, stats[key]]));
const visible = root => readdirSync(root).filter(name => name !== '.replaylock').sort();
function readInput(filename) {
  if (realpathSync.native(filename) !== filename) throw failure();
  const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > 65536n) throw failure();
    const buffer = Buffer.alloc(65537);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const bytes = buffer.subarray(0, length), text = bytes.toString('utf8');
    if (length > 65536 || !Buffer.from(text).equals(bytes) || identity(before) !== identity(after)
      || identity(after) !== identity(statSync(filename, { bigint: true })) || realpathSync.native(filename) !== filename) throw failure();
    return { text, stats: statsRecord(after) };
  } finally { closeSync(descriptor); }
}

export function captureFixtureAnalysis(directory) {
  const root = realpathSync.native(directory);
  if (!path.basename(root).startsWith('replaylock-import-workflow-')
    || JSON.parse(readInput(path.join(root, 'package.json')).text).name !== 'synthetic-import-workflow'
    || visible(root).join('\0') !== [...files, 'node_modules'].sort().join('\0')) throw failure();
  const records = [];
  for (const name of files) {
    const filename = path.join(root, name);
    records.push({ name, ...readInput(filename), directory: false });
  }
  const rootStats = statsRecord(statSync(root, { bigint: true }));
  const modules = path.join(root, 'node_modules');
  if (realpathSync.native(modules) !== modules || !statSync(modules).isDirectory()) throw failure();
  const snapshot = { root, records, rootStats, modulesStats: statsRecord(statSync(modules, { bigint: true })) };
  const current = () => {
    try {
      const currentRoot = statSync(root, { bigint: true });
      if (realpathSync.native(root) !== root || ['dev', 'ino', 'mode'].some(key => currentRoot[key] !== rootStats[key])
        || visible(root).join('\0') !== [...files, 'node_modules'].sort().join('\0')) return false;
      for (const record of records) {
        const filename = path.join(root, record.name);
        const input = readInput(filename);
        if (identity(input.stats) !== identity(record.stats) || input.text !== record.text) return false;
      }
      return realpathSync.native(modules) === modules && identity(statSync(modules, { bigint: true })) === identity(snapshot.modulesStats);
    } catch { return false; }
  };
  if (!current()) throw failure();
  return { snapshot, current };
}

export function sealFixtureAnalysis(directory) {
  if (!isMainThread || !clientInstalled) throw failure();
  const { snapshot, current } = captureFixtureAnalysis(directory);
  const { root } = snapshot;
  if (snapshots.has(root)) throw failure();
  snapshots.set(root, snapshot);
  return { current, release: () => snapshots.delete(root) };
}

// Exact loaded-source pins guard this private rewriting, not the whole toolchain.
const activeWorker = !isMainThread && workerData?.replaylockPrototypeAnalysis;
if (isMainThread || activeWorker) registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    const pin = pins.get(url);
    if (!pin || (isMainThread && !url.endsWith('/dev-analysis-client.js'))) return result;
    const bytes = Buffer.from(result.source);
    if (createHash('sha256').update(bytes).digest('hex') !== pin) throw failure();
    let code = bytes.toString('utf8');
    if (isMainThread) {
      code = code.replace('from "node:worker_threads"', `from ${JSON.stringify(new URL('./prototype-import-analysis-worker-bridge.mjs', import.meta.url).href)}`);
      clientInstalled = true;
    } else if (url.endsWith('/dev-analysis-worker.js')) {
      const marker = 'parentPort.postMessage({ id: request.id, result });';
      if (!code.includes(marker)) throw failure();
      code = `import { assertSnapshot } from ${JSON.stringify(new URL('./prototype-import-analysis-fs.mjs', import.meta.url).href)};\n` + code.replace(marker, `assertSnapshot(); ${marker}`);
    } else {
      if (!code.includes('from "node:fs"')) throw failure();
      code = code.replace('from "node:fs"', `from ${JSON.stringify(new URL('./prototype-import-analysis-fs.mjs', import.meta.url).href)}`);
    }
    if (code === bytes.toString('utf8')) throw failure();
    return { ...result, source: code };
  },
});
// No source or dependency file is rewritten; unrelated Workers are unchanged.
