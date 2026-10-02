// Retained #125 evaluation harness, not a production scan mode.
// Usage: node docs/plans/branch-proof-epic-scan.mjs APP_ROOT [BASELINE_DIST]
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fs.realpathSync.native(process.argv[2]);
const expectedRevision = '8473afd804b66dba6a23f317908dc35d1535e90d';
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== expectedRevision) throw new Error('Pinned application revision changed');
const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });

// Existing analysis hashes dotenv metadata, which is not a branch-proof fact.
// Exclude those entries and forbid any fallback read, without altering disk.
// Thus this comparison is NOT the application's loaded-config/full-fingerprint
// scan. It uses explicit default development conditions and no config hooks.
const isDotenv = file => /^\.env(?:\..*)?$/.test(path.basename(String(file)));
const originalRead = fs.readFileSync;
const originalList = fs.readdirSync;
fs.readFileSync = function(file, ...args) {
  if (isDotenv(file)) throw new Error('Evaluation forbids dotenv reads');
  return originalRead.call(this, file, ...args);
};
fs.readdirSync = function(directory, ...args) {
  return originalList.call(this, directory, ...args).filter(entry => !isDotenv(typeof entry === 'string' ? entry : entry.name));
};
syncBuiltinESMExports();

const targets = [
  'app/root.tsx#meta',
  'app/routes/_auth/forgot-password.tsx#meta',
  'app/routes/_auth/login.tsx#meta',
  'app/routes/_auth/onboarding/$provider.tsx#meta',
  'app/routes/_auth/onboarding/index.tsx#meta',
  'app/routes/_auth/reset-password.tsx#meta',
  'app/routes/_auth/signup.tsx#meta',
  'app/routes/users/$username/notes/$noteId.tsx#meta',
  'app/utils/auth.server.ts#getSessionExpirationDate',
  'app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasFile',
  'app/routes/users/$username/notes/+shared/note-editor.server.tsx#imageHasId',
];
const key = locator => `${locator.module}#${locator.namePath.join('.')}`;
const scans = process.argv[3] ? [['baseline', path.resolve(process.argv[3])]] : [];
scans.push(['prototype', path.resolve(import.meta.dirname, '../../dist')]);
const results = [];
try {
  for (const [label, dist] of scans) {
    const { analyzeDevProject } = await import(pathToFileURL(path.join(dist, 'dev-analysis.js')).href);
    const { resolveDevOptions } = await import(pathToFileURL(path.join(dist, 'dev-options.js')).href);
    const options = { ...resolveDevOptions(), resolveConditions: {
      node: ['module', 'node', 'development'], browser: ['module', 'browser', 'development'],
    } };
    for (const environment of ['node', 'browser']) {
      const analysis = analyzeDevProject(root, options, environment);
      results.push({ label, environment, eligible: analysis.targets.length, targets: targets.map(target => ({
        target, eligible: analysis.targets.some(item => key(item.locator) === target),
        findings: analysis.diagnostics.filter(item => item.locator && key(item.locator) === target).map(item => ({
          code: item.code, origin: item.causes?.at(-1) ?? item.position,
        })),
      })) });
    }
  }
} finally {
  fs.readFileSync = originalRead;
  fs.readdirSync = originalList;
  syncBuiltinESMExports();
}
const after = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
if (before !== after) throw new Error('Application worktree status changed during evaluation');
console.log(JSON.stringify({ revision, method: 'explicit-default-development-conditions; dotenv metadata excluded; no application config hooks or imports', results }, null, 2));
