import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareBrowserLatency } from './bench-dev-browser.mjs';

const [reportPath, budgetPath] = process.argv.slice(2);
assert.ok(reportPath && budgetPath, 'usage: node scripts/check-browser-budget.mjs REPORT BUDGET');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
assert.equal(budget.schemaVersion, 1);
assert.deepEqual(Object.keys(budget.maximumAddedMedianMs).sort(), ['coldPageMs', 'navigationMs', 'visibleHmrMs']);
console.log(JSON.stringify(compareBrowserLatency(report, budget.maximumAddedMedianMs)));
console.log('BROWSER LATENCY BUDGET MET');
