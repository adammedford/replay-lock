// RETAINED #127 attachment feasibility. Not evaluated-source qualification.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { controlFixtureCode, attachFixtureClientControls } from './prototype-import-attachment-controls.mjs';

const modes = new Set(['release', 'mutate', 'refuse']);
const refused = code => Object.assign(new Error(code), { code });

async function fixtureRoot(directory) {
  const root = await realpath(directory);
  if (!path.basename(root).startsWith('replaylock-import-workflow-')
    || JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name !== 'synthetic-import-workflow') throw refused('ATTACHMENT_CONTEXT_REFUSED');
  return root;
}

async function checkPackagePins() {
  const require = createRequire(import.meta.url);
  for (const [name, version] of [['vite', '8.2.2'], ['vitest', '4.1.11'], ['@vitest/browser', '4.1.11']]) {
    const metadata = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'));
    if (metadata.version !== version) throw refused('ATTACHMENT_VERSION_REFUSED');
  }
}

export function fixtureReplayDeliveryAttachment() {
  let root, mode;
  return {
    name: 'prototype-replay-delivery-attachment',
    async configResolved(config) {
      if (!process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_ROOT || config.mode !== 'test') return;
      root = await fixtureRoot(config.root);
      mode = process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_MODE;
      if (root !== await realpath(process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_ROOT)
        || !modes.has(mode)) throw refused('ATTACHMENT_CONTEXT_REFUSED');
      await checkPackagePins();
    },
    configureServer(server) {
      if (!root) return;
      attachFixtureClientControls(server, root, mode);
    },
  };
}

// Fixture-only preload, inherited by the normal CLI's isolated descendants.
if (process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_ROOT) {
  const root = await fixtureRoot(process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_ROOT);
  const mode = process.env.REPLAYLOCK_PROTOTYPE_EVALUATOR_MODE;
  if (root !== await realpath(process.cwd()) || !modes.has(mode)) throw refused('ATTACHMENT_CONTEXT_REFUSED');
  await checkPackagePins();
  const require = createRequire(import.meta.url);
  const metadataPath = require.resolve('vitest/package.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const filename = path.join(path.dirname(metadataPath), 'dist/module-evaluator.js');
  const bytes = await readFile(filename);
  if (metadata.version !== '4.1.11' || createHash('sha256').update(bytes).digest('hex')
    !== 'a0b36fb2211d2587d8df68d5855d48141be27e99bdb973378a83f927e03b004e') throw refused('ATTACHMENT_VERSION_REFUSED');
  const { VitestModuleEvaluator } = await import(pathToFileURL(filename).href);
  const original = VitestModuleEvaluator.prototype.runInlinedModule;
  if (typeof original !== 'function') throw refused('ATTACHMENT_VERSION_REFUSED');
  // Vite can bundle this fixture's config import into another module instance.
  const installed = Symbol.for('replaylock.prototype.evaluator-attachment');
  if (!VitestModuleEvaluator.prototype[installed]) {
    VitestModuleEvaluator.prototype[installed] = true;
    VitestModuleEvaluator.prototype.runInlinedModule = function(context, code, module) {
      code = controlFixtureCode(root, mode, module.file, code);
      return original.call(this, context, code, module);
    };
  }
}

export async function verifyAttached(root, mode, { analysisMode } = {}) {
  if (!modes.has(mode) || process.env.NODE_OPTIONS) throw refused('ATTACHMENT_OPTIONS_REFUSED');
  if (analysisMode !== undefined && !['release', 'refuse'].includes(analysisMode)) throw refused('ATTACHMENT_OPTIONS_REFUSED');
  root = await fixtureRoot(root);
  const analysisOptions = analysisMode === undefined ? ''
    : `--import=${new URL('./prototype-import-replay-analysis-preload.mjs', import.meta.url).href} `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'verify'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...process.env, NODE_OPTIONS: `${analysisOptions}--import=${import.meta.url}`,
        ...(analysisMode === undefined ? {} : { REPLAYLOCK_PROTOTYPE_ANALYSIS_ROOT: root, REPLAYLOCK_PROTOTYPE_ANALYSIS_MODE: analysisMode }),
        REPLAYLOCK_PROTOTYPE_EVALUATOR_ROOT: root, REPLAYLOCK_PROTOTYPE_EVALUATOR_MODE: mode },
    });
    const chunks = [];
    let bytes = 0, termination;
    const terminate = reason => {
      if (termination || !child.pid) return;
      termination = reason;
      if (process.platform === 'win32') child.kill('SIGKILL');
      else {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') { termination += `:${error.code}`; child.kill('SIGKILL'); } }
      }
    };
    const timer = setTimeout(() => terminate('ATTACHMENT_TIMEOUT'), 45000);
    const collect = chunk => {
      const remaining = 1024 * 1024 - bytes;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); bytes += Math.min(chunk.length, remaining); }
      if (chunk.length > remaining) terminate('ATTACHMENT_OUTPUT_LIMIT');
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => {
      clearTimeout(timer);
      resolve({ status: termination ? null : status, output: `${termination ?? ''}\n${Buffer.concat(chunks).toString('utf8')}` });
    });
  });
}
