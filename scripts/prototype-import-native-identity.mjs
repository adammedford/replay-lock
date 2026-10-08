// RETAINED #127: compatibility acquisition, not executable-output qualification.
// Deliberately only the measured Darwin ARM64 route; other platforms refuse.
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const refuse = () => Object.assign(new Error('NATIVE_RECIPE_REFUSED'), { code: 'NATIVE_RECIPE_REFUSED' });
const hooks = ['load', 'resolveId', 'transform', 'watchChange'];
const pins = [
  ['binding-C__LJDBG.mjs', '20227dd9120aa1f62f39fe02cc9db909c61f41f172830d97a7350b8a23618ea3'],
  ['normalize-string-or-regex-CFtim40S.mjs', 'ee2f736ddaeb3ca9e435f3e3b823834aabbf7ec935fba5ab7ee0547c87eb459a'],
  ['constructors-DklcHr18.mjs', 'ec42b07a5ad6a91ed5abb74816f7469b6083582e846a73b52de86d08984d31e7'],
];

export async function acquireFixtureNativeIdentity(server) {
  // Reject selectors even when the loader was already imported/cached. Never
  // silently clear an override or load it to discover whether it is harmless.
  if (process.platform !== 'darwin' || process.arch !== 'arm64'
    || ['NAPI_RS_NATIVE_LIBRARY_PATH', 'NAPI_RS_FORCE_WASI', 'NAPI_RS_WASI_FLAVOR']
      .some(key => Object.hasOwn(process.env, key))
    || process.versions.webcontainer || process.versions.pnp) throw refuse();
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('rolldown/package.json');
  const directory = path.join(path.dirname(packagePath), 'dist/shared');
  if (JSON.parse(await readFile(packagePath, 'utf8')).version !== '1.2.5') throw refuse();
  for (const [name, expected] of pins) {
    if (createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex') !== expected) throw refuse();
  }
  const filename = await realpath(require.resolve('@rolldown/binding-darwin-arm64'));
  if (JSON.parse(await readFile(require.resolve('@rolldown/binding-darwin-arm64/package.json'), 'utf8')).version !== '1.2.5'
    || createHash('sha256').update(await readFile(filename)).digest('hex')
      !== 'f5738d2772a6c37175dcbfafd3191575dd047f0c811a8367c48f02b9f1ba5fee') throw refuse();
  // The pinned adapter consumes this exact loader. Compare export-object
  // identity, not merely the existence of a candidate file in require.cache.
  const { t: loadBinding } = await import(pathToFileURL(path.join(directory, pins[0][0])).href);
  const binding = loadBinding();
  if (!require.cache[filename] || require.cache[filename].exports !== binding) throw refuse();
  const matches = Object.values(require.cache).filter(module => module.exports === binding);
  if (matches.length !== 1 || matches[0].filename !== filename) throw refuse();

  const container = server.environments.ssr.pluginContainer;
  const records = [];
  for (const name of ['builtin:oxc-runtime', 'builtin:vite-json']) {
    const plugins = server.environments.ssr.plugins.filter(plugin => plugin.name === name);
    if (plugins.length !== 1) throw refuse();
    const plugin = plugins[0];
    const expectedKeys = ['name', '_options', 'enforce', 'getOrder', ...hooks,
      ...(name === 'builtin:oxc-runtime' ? ['applyToEnvironment'] : [])].sort();
    if (!isDeepStrictEqual(Object.keys(plugin).sort(), expectedKeys)
      || !isDeepStrictEqual(plugin._options, name === 'builtin:vite-json'
        ? { namedExports: true, stringify: 'auto', minify: false } : undefined)
      || plugin.enforce !== undefined) throw refuse();
    const orders = {};
    for (const hook of hooks) {
      const value = plugin[hook];
      const expected = name === 'builtin:oxc-runtime' && ['load', 'resolveId'].includes(hook) ? 'pre' : 'normal';
      const order = typeof value === 'function' ? 'normal' : value?.order;
      if (order !== expected || (typeof value !== 'function' && typeof value?.handler !== 'function')
        || container.getSortedPlugins(hook).filter(candidate => candidate === plugin).length !== 1) throw refuse();
      orders[hook] = order;
    }
    records.push(Object.freeze({ name, orders: Object.freeze(orders) }));
  }
  const transforms = container.getSortedPlugins('transform').map(plugin => plugin.name);
  const index = name => {
    if (transforms.filter(value => value === name).length !== 1) throw refuse();
    return transforms.indexOf(name);
  };
  if (!(index('replaylock:dev') < index('builtin:oxc-runtime')
    && index('builtin:oxc-runtime') < index('vite:oxc')
    && index('vite:oxc') < index('builtin:vite-json'))) throw refuse();
  return Object.freeze({ platform: 'darwin-arm64', version: '1.2.5', filename,
    records: Object.freeze(records), transforms: Object.freeze(transforms) });
}
