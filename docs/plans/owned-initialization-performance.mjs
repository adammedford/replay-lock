// Retained #126 evaluation; public analysis/transform workload, not page latency.
// Usage: node docs/plans/owned-initialization-performance.mjs BASELINE_DIST
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const baseline = path.resolve(process.argv[2]);
const current = path.resolve(import.meta.dirname, '../../dist');
const versions = [['baseline', baseline], ['prototype', current]];
const runtimes = new Map();
for (const [label, dist] of versions) {
  const { createDevProjectCache } = await import(pathToFileURL(path.join(dist, 'dev-transform.js')).href);
  const { resolveDevOptions } = await import(pathToFileURL(path.join(dist, 'dev-options.js')).href);
  runtimes.set(label, { createDevProjectCache, resolveDevOptions });
}
const root = await mkdtemp(path.join(tmpdir(), 'replaylock-owned-performance-'));
const rows = [];
try {
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await mkdir(path.join(root, 'src'));
  for (const size of [10, 1000]) {
    const files = Array.from({ length: size }, (_, i) => ({ id: path.join(root, 'src', `m${i}.js`), code: `export function value(n){return n+${i};}` }));
    files.push({ id: path.join(root, 'src', 'table.js'), code: `const table=[${Array(256).fill('0').join(',')}]; for(let i=0;i<256;i++){table[i]=i*2;} export function answer(){return table[255];}` });
    for (const file of files) await writeFile(file.id, file.code);
    for (let pair = 0; pair < 5; pair++) {
      for (const [label] of pair % 2 ? [...versions].reverse() : versions) {
        const { createDevProjectCache, resolveDevOptions } = runtimes.get(label);
        const options = resolveDevOptions();
        for (const environment of ['node', 'browser']) {
          const cache = createDevProjectCache(root, options);
          const start = performance.now();
          const analysis = cache.analyze(environment);
          for (const file of files) cache.transform({ root, id: file.id, code: file.code, environment, options, generation: 'measurement' });
          const coldLoadMs = performance.now() - start;
          assert.equal(analysis.targets.length, size + (label === 'prototype' ? 1 : 0));
          const changed = { ...files[0], code: files[0].code.replace('n+0', 'n+1') };
          await writeFile(changed.id, changed.code);
          const editStart = performance.now();
          cache.transform({ root, id: changed.id, code: changed.code, environment, options, generation: 'edit' });
          const editToReadyMs = performance.now() - editStart;
          await writeFile(files[0].id, files[0].code);
          rows.push({ label, pair, environment, ordinaryModules: size, ownedTableSlots: 256, coldLoadMs, editToReadyMs });
        }
      }
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const comparisons = [];
for (const size of [10, 1000]) for (const environment of ['node', 'browser']) {
  const by = label => rows.filter(row => row.label === label && row.ordinaryModules === size && row.environment === environment);
  const base = median(by('baseline').map(row => row.coldLoadMs));
  const final = median(by('prototype').map(row => row.coldLoadMs));
  const budgetMs = Math.max(20, base * 0.1);
  comparisons.push({ ordinaryModules: size, environment, baselineMedianMs: base, prototypeMedianMs: final, overheadMs: final - base, budgetMs, withinAdditiveRegressionBudget: final - base <= budgetMs });
}
console.log(JSON.stringify({ node: process.versions.node, pairs: 5, baseline, prototype: current, method: 'same-process alternating public cold analysis plus every transform and saved-source edit; one 256-slot owned table; not end-user latency or historical 50-percent speedup replication', rows, comparisons }, null, 2));
assert.ok(comparisons.every(row => row.withinAdditiveRegressionBudget), 'prototype additive regression budget exceeded');
console.log('OWNED INITIALIZATION RESPONSIVENESS PASSED');
