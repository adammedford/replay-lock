// Diagnostic guard for the fixed two-file Node fixture; not full G1B.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { controlFixtureCode } from './prototype-import-attachment-controls.mjs';

const failure = () => Object.assign(new Error('EVALUATED_INPUT_REFUSED'), { code: 'EVALUATED_INPUT_REFUSED' });
export function createFinalNodeFixtureGuard(server, root, table, mode) {
  let prepared = false, refused = false;
  const fail = () => { refused = true; throw failure(); };
  const recipe = table.finalRecipe;
  const environment = server.environments.ssr;
  if (!recipe || recipe.revision !== 1 || table.records.length !== 2
    || !['release', 'mutate', 'unguarded-mutate', 'withheld-mutate'].includes(mode)
    || environment.config.consumer !== 'server' || !environment.config.keepProcessEnv
    || !environment.config.dev.moduleRunnerTransform || environment.config.dev.preTransformRequests
    || environment.config.define !== undefined
    || !isDeepStrictEqual(environment.config.resolve.external, ['replaylock'])
    || !isDeepStrictEqual(environment.config.resolve.noExternal, [])
    || environment.config.resolve.preserveSymlinks || !environment.config.optimizeDeps.noDiscovery) fail();
  const records = new Map();
  for (const record of table.records) {
    if (!record.final || !['/entry.mjs', '/helper.mjs'].includes(record.final.url)
      || record.id !== path.join(root, record.final.url.slice(1)) || record.final.id !== record.id
      || record.final.file !== record.id || records.has(record.id)) fail();
    records.set(record.id, record.final);
  }
  if ([...records.values()].reduce((bytes, record) => bytes + Buffer.byteLength(record.code), 0) > 262144) fail();
  const equal = (value, expected) => isDeepStrictEqual(value, expected);
  return {
    startOffset: recipe.startOffset,
    async prepare() {
      // Deliberately reject subsequent turns instead of trusting a namespace
      // cache path which can skip the evaluator. No warm-ownership claim.
      if (refused || prepared || server._ssrCompatModuleRunner !== undefined) fail();
      try {
        for (const expected of records.values()) {
          const actual = await environment.fetchModule(expected.url, undefined, { cached: false, startOffset: recipe.startOffset });
          const { invalidate, ...representation } = actual;
          if (mode === 'withheld-mutate') representation.code = controlFixtureCode(root, 'mutate', actual.file, actual.code);
          if (invalidate !== true || !equal(representation, expected)) fail();
        }
        prepared = true; // Both preparations passed; no runner.import occurred.
      } catch { fail(); }
    },
    compare(code, module) {
      const file = module.meta?.file;
      if (refused || !prepared) fail();
      const expected = records.get(file);
      if (!expected || module.meta.invalidate !== false) fail();
      if (mode === 'unguarded-mutate') return; // Same late control, comparator disabled.
      const { id, url } = module.meta;
      if (!equal({ code, file, id, url }, expected)) fail();
    },
    external(filepath) {
      // Only the fixture's declared observer entry may use native import.
      // This is a route constraint, not that entry's transitive qualification.
      if (refused || !prepared || filepath !== recipe.runtimeFile) fail();
    },
  };
}
