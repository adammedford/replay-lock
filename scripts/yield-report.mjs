// Report which callables development capture can instrument in a project and,
// for the rest, how often each reason code excludes them. Explicitly invoked;
// not part of correctness verification.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeDevProject } from '../dist/dev-analysis.js';
import { loadDevConfiguration, resolveDevOptions } from '../dist/dev-options.js';
import { DEV_CATALOG_VERSION } from '../dist/dev-catalog.js';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const unknown = args.filter((arg, index) => !['--root', '--json', '--defaults'].includes(arg) && args[index - 1] !== '--root');
if (unknown.length) { console.error('Usage: npm run yield:dev -- [--root <project>] [--json] [--defaults]'); process.exit(2); }
const root = path.resolve(value('--root') ?? process.cwd());
// --defaults skips the project's Vite and ReplayLock configuration, for
// projects whose configuration cannot load outside their own toolchain.
const { options } = args.includes('--defaults') ? { options: resolveDevOptions() } : await loadDevConfiguration(root);
const locator = item => `${item.module}#${item.namePath.join('.')}`;
const environments = [];
for (const environment of ['node', 'browser']) {
  const started = performance.now();
  const analysis = analyzeDevProject(root, options, environment);
  const milliseconds = Math.round(performance.now() - started);
  const skipped = new Map();
  for (const diagnostic of analysis.diagnostics) {
    const key = locator(diagnostic.locator);
    skipped.set(key, new Set([...(skipped.get(key) ?? []), diagnostic.code]));
  }
  const codes = {};
  for (const set of skipped.values()) for (const code of set) codes[code] = (codes[code] ?? 0) + 1;
  environments.push({
    environment, milliseconds,
    eligible: analysis.targets.map(target => locator(target.locator)).sort(),
    skipped: skipped.size,
    codes: Object.fromEntries(Object.entries(codes).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))),
  });
}
if (args.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, catalogVersion: DEV_CATALOG_VERSION, root, environments }, null, 2));
else {
  console.log(`Development catalog ${DEV_CATALOG_VERSION}: ${root}`);
  for (const report of environments) {
    const total = report.eligible.length + report.skipped;
    console.log(`\n${report.environment}: ${report.eligible.length} of ${total} callables eligible (${report.milliseconds} ms)`);
    for (const [code, count] of Object.entries(report.codes)) console.log(`  ${code.padEnd(26)} ${String(count).padStart(5)}  ${(100 * count / report.skipped).toFixed(0).padStart(3)}% of skipped`);
    for (const item of report.eligible) console.log(`  eligible ${item}`);
  }
}
// Application configuration plugins can leave services open after Vite closes.
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(0);
