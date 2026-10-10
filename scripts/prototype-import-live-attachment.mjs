// RETAINED #127 live attachment controls, not qualified transformed-byte binding.
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { controlFixtureCode, attachFixtureClientControls } from './prototype-import-attachment-controls.mjs';

const refused = code => Object.assign(new Error(code), { code });

export async function attachLiveFixtureControls(server, directory, mode, finalGuard) {
  const root = await realpath(directory);
  if (!['release', 'mutate', 'refuse'].includes(mode) || root !== await realpath(server.config.root)
    || !path.basename(root).startsWith('replaylock-import-workflow-')
    || JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name !== 'synthetic-import-workflow'
    || Object.hasOwn(server, '_ssrCompatModuleRunner')) throw refused('ATTACHMENT_CONTEXT_REFUSED');
  const require = createRequire(import.meta.url);
  const metadataPath = require.resolve('vite/package.json');
  if (JSON.parse(await readFile(metadataPath, 'utf8')).version !== '8.2.2') throw refused('ATTACHMENT_VERSION_REFUSED');
  for (const [filename, expected] of [
    ['dist/node/chunks/node.js', 'f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0'],
    ['dist/node/module-runner.js', 'c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92'],
  ]) {
    const bytes = await readFile(path.join(path.dirname(metadataPath), filename));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw refused('ATTACHMENT_VERSION_REFUSED');
  }
  let runner, retired = false;
  // Vite assigns its own runner synchronously before instantiateModule starts.
  // Capture that assignment, not a promise returned after import has begun.
  Object.defineProperty(server, '_ssrCompatModuleRunner', {
    configurable: false,
    get: () => runner,
    set(value) {
      if (value === undefined) {
        if (runner && !runner.isClosed()) throw refused('ATTACHMENT_CONTEXT_REFUSED');
        retired = true; runner = undefined; return; // Vite's ordinary close cleanup.
      }
      if (retired || runner || typeof value?.evaluator?.runInlinedModule !== 'function') throw refused('ATTACHMENT_CONTEXT_REFUSED');
      const evaluator = value.evaluator;
      if (finalGuard && evaluator.startOffset !== finalGuard.startOffset) throw refused('ATTACHMENT_CONTEXT_REFUSED');
      if (finalGuard) {
        if (typeof evaluator.runExternalModule !== 'function') throw refused('ATTACHMENT_CONTEXT_REFUSED');
        const external = evaluator.runExternalModule;
        evaluator.runExternalModule = function(filepath) {
          finalGuard.external(filepath);
          return external.call(this, filepath);
        };
      }
      const original = evaluator.runInlinedModule;
      evaluator.runInlinedModule = function(context, code, module) {
        code = controlFixtureCode(root, mode, module.meta?.file, code);
        finalGuard?.compare(code, module); // After, never before, the late control.
        return original.call(this, context, code, module);
      };
      runner = value;
    },
  });
  attachFixtureClientControls(server, root, mode);
}
