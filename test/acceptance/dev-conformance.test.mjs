import assert from 'node:assert/strict';
import test from 'node:test';
import { runConformance } from '../../scripts/dev-conformance.mjs';
test('32 fixed seeds in Node and Chromium preserve completions, order, mutation and native counts; replay is offline',{timeout:120000},async()=>{
  const result=await runConformance();assert.equal(result.seeds.length,32);
  for(const realm of ['node','browser']){const r=result.realms[realm];assert.equal(r.executed,96);assert.equal(r.replayed,84);assert.equal(r.excluded,12);assert.equal(r.throws,6);assert.deepEqual(r.faults,{observerFailures:true,capacity:1001,detachedRejected:true});}
});
test('one seed reruns independently',async()=>{const result=await runConformance({seed:3,realm:'node'});assert.deepEqual(result.seeds,[3]);assert.equal(result.realms.node.replayed,3);});
