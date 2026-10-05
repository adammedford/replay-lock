// Private finite read/probe projection shared by live and replay experiments.
import path from 'node:path';

export function createSnapshotView(snapshot, code = 'ANALYSIS_INPUT_REFUSED') {
  let refused = false;
  const fail = () => { refused = true; throw new Error(code); };
  function assertSnapshot() { if (refused) throw new Error(code); }
  const records = new Map(snapshot.records.map(record => [path.join(snapshot.root, record.name), record]));
  records.set(snapshot.root, { stats: snapshot.rootStats, directory: true });
  records.set(path.join(snapshot.root, 'node_modules'), { stats: snapshot.modulesStats, directory: true });
  function lookup(file) {
    if (typeof file !== 'string' || path.resolve(file) !== file) return fail();
    const record = records.get(file);
    if (record) return record;
    // A direct child absent from the frozen complete listing is known absent.
    if (path.dirname(file) === snapshot.root) return undefined;
    return fail();
  }
  function missing() { throw Object.assign(new Error('snapshot entry absent'), { code: 'ENOENT' }); }
  function statSync(file, options) {
    const record = lookup(file);
    if (!record) { if (options?.throwIfNoEntry === false) return undefined; return missing(); }
    return { ...Object.fromEntries(Object.entries(record.stats).map(([key, value]) => [key, options?.bigint ? value : Number(value)])),
      isFile: () => !record.directory, isDirectory: () => record.directory };
  }
  function readFileSync(file, encoding) {
    const record = lookup(file);
    if (!record) return missing();
    if (record.directory || encoding !== 'utf8') return fail();
    return record.text;
  }
  function realpathSync(file) { if (!lookup(file)) return missing(); return file; }
  realpathSync.native = realpathSync;
  function readdirSync(file, options) {
    if (file !== snapshot.root || options?.withFileTypes !== true) return fail();
    return [...snapshot.records.map(record => ({ name: record.name, isFile: () => true, isDirectory: () => false })),
      { name: 'node_modules', isFile: () => false, isDirectory: () => true }];
  }
  return { assertSnapshot, statSync, lstatSync: statSync, readFileSync, realpathSync, readdirSync };
}
