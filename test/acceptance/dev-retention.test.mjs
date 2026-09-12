import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadDevRetention } from '../../dist/dev-retention.js';
import { resolveDevOptions, resolveDevRetention } from '../../dist/dev-options.js';
import { createDevCandidate, createDevGroupId, persistDevObservations, toDevCase } from '../../dist/dev-artifacts.js';
import { configureDevRuntime, observeDevCall, devEffect, runtimeProfile } from '../../dist/dev-runtime.js';
import { encodeDevValue } from '../../dist/dev-values.js';
import { recoverDevelopment } from '../../dist/dev-server.js';
import { createDevSessionReport } from '../../dist/dev-report.js';
import { fixture, put, jsonFiles, digest } from '../helpers/dev-fixture.mjs';
const profiles={node:runtimeProfile('node'),browser:{environment:'browser',runtime:'Chromium',timezone:'UTC',locale:'en-US'}};
function observation(n=1, input=5, name='roll') {return {locator:{module:'src/roll.js',kind:'export',namePath:[name]},environment:'node',generation:'0001',sourceGraphDigest:digest,arguments:encodeDevValue([input]),trace:[{kind:'call',id:0,operation:'Math.random',arguments:encodeDevValue([])},{kind:'return',id:0,value:encodeDevValue(n/10000)}],completion:{kind:'return',value:encodeDevValue(input+n/10000)}};}
const candidate = o=>createDevCandidate(o,digest,profiles[o.environment]);
test('10,000 drained calls execute every native read and retain only two same-group correlations',async t=>{
  const root=await fixture(t), retention=await loadDevRetention(root), admitted=[], counts={retained:0,duplicate:0,omitted:0};
  let native=0;
  configureDevRuntime({onObservation(o){const status=retention.admit(candidate(o)).status;counts[status]++;if(status==='retained')admitted.push(o);},onBlock(b){assert.fail(b.code);}});
  t.after(()=>configureDevRuntime(undefined));
  const meta=observation();delete meta.arguments;delete meta.trace;delete meta.completion;
  for(let i=1;i<=10000;i++) assert.equal(observeDevCall(meta,[5],frame=>5+devEffect(frame,'Math.random',[],()=>++native/10000)),5+i/10000);
  assert.equal(native,10000);assert.deepEqual(counts,{retained:2,duplicate:0,omitted:9998});
  assert.equal(retention.snapshot().admissions.length,2);assert.ok(JSON.stringify(retention.snapshot()).length<2000);
  assert.equal(retention.admit(candidate(observation(3,6))).status,'retained');
  assert.equal(retention.admit(candidate(observation(3,5,'other'))).status,'retained');
  const omitted=observation(3);omitted.completion.value=encodeDevValue(999);
  assert.equal(retention.admit(candidate(omitted)).status,'omitted');
  assert.equal(retention.admit(candidate(admitted[0])).status,'duplicate');
  const result=await persistDevObservations(root,admitted,digest,profiles,{retentionState:retention.snapshot(),retentionSealed:true});
  assert.equal(result.candidates,2);assert.equal(result.blocked,0);
  assert.deepEqual((await jsonFiles(root,'.replaylock/observations/pending-v2')).map(c=>c.trace).sort(),admitted.map(c=>c.trace).sort());
});
test('group structure ignores external values, effect inputs and completion, but preserves explicit inputs, operations and settlement order',()=>{
  const a=candidate(observation()), b=candidate(observation(2));assert.equal(createDevGroupId(a),createDevGroupId(b));assert.notEqual(a.caseId,b.caseId);
  const withArgs=observation();withArgs.trace[0].arguments=encodeDevValue(['different']);assert.equal(createDevGroupId(a),createDevGroupId(candidate(withArgs)));
  assert.notEqual(createDevGroupId(a),createDevGroupId(candidate(observation(1,6))));
  const clock=observation();clock.trace[0].operation='Date.now';assert.notEqual(createDevGroupId(a),createDevGroupId(candidate(clock)));
  const pairs=observation();pairs.trace=[{kind:'call',id:0,operation:'fs.readFile',arguments:encodeDevValue(['a'])},{kind:'call',id:1,operation:'fs.readFile',arguments:encodeDevValue(['b'])},{kind:'return',id:0,value:encodeDevValue('a')},{kind:'return',id:1,value:encodeDevValue('b')}];
  const reverse=structuredClone(pairs);reverse.trace.splice(2,2,...reverse.trace.slice(2).reverse());assert.notEqual(createDevGroupId(candidate(pairs)),createDevGroupId(candidate(reverse)));
});
test('pending quotas persist; lowered limits do not prune; accepted replacements bypass sampling and conflicts survive',async t=>{
  const root=await fixture(t);await persistDevObservations(root,[observation(1),observation(2)],digest,profiles);
  const retention=await loadDevRetention(root,{maxPerCallable:1,maxPerGroup:1});assert.equal(retention.admit(candidate(observation(3))).status,'omitted');
  assert.equal((await jsonFiles(root,'.replaylock/observations/pending-v2')).length,2);
  const accepted=toDevCase(candidate(observation(3)));await put(root,`.replaylock/cases/${accepted.caseId}.json`,JSON.stringify(accepted));
  const replacement=observation(3);replacement.completion.value=encodeDevValue(99);
  const next=await loadDevRetention(root,{maxPerCallable:1,maxPerGroup:1});assert.equal(next.admit(candidate(replacement)).status,'retained');
  const result=await persistDevObservations(root,[replacement],digest,profiles,{retentionState:next.snapshot(),retentionSealed:true});assert.equal(result.candidates,1);
  assert.equal(JSON.parse(await readFile(path.join(root,'.replaylock/cases',`${accepted.caseId}.json`),'utf8')).completion.value.value,5.0003);
  const conflict=await persistDevObservations(root,[observation(1),{...observation(1),completion:{kind:'return',value:encodeDevValue(88)}}],digest,profiles,{retention:{maxPerCallable:1,maxPerGroup:1}});assert.ok(conflict.blocks.some(b=>b.code==='OBSERVED_NONDETERMINISM'));
});
test('recovery uses original policy and sealed decisions despite changed configuration; old sessions remain legacy',async t=>{
  for(const modern of [true,false]){
    const root=await fixture(t),id=randomUUID(),directory=`.replaylock/observations/dev-sessions/${id}`;
    await put(root,'replaylock.config.mjs','export default {capture:{retention:{maxPerCallable:1,maxPerGroup:1}}};');
    const retention=await loadDevRetention(root,false);for(let n=1;n<=3;n++)retention.admit(candidate(observation(n)));
    await put(root,`${directory}/metadata.json`,JSON.stringify({lockfileDigest:digest,profiles,...(modern?{retention:false}:{})}));
    if(modern)await put(root,`${directory}/admission.json`,JSON.stringify(retention.snapshot()));
    if(modern)await put(root,`${directory}/report.json`,JSON.stringify(createDevSessionReport(id).snapshot()));
    for(let n=1;n<=3;n++)await put(root,`${directory}/${n}.json`,JSON.stringify({observation:observation(n),profile:profiles.node}));
    assert.equal(await recoverDevelopment(root,id),0);assert.equal((await jsonFiles(root,'.replaylock/observations/pending-v2')).length,3);
    const report=JSON.parse(await readFile(path.join(root,directory,'report.json'),'utf8'));assert.equal(report.status,'partial');assert.equal(report.countsComplete,false);
    assert.equal(report.rows[0].execution,'observed');assert.equal(report.rows[0].retained,3);assert.equal(report.rows[0].invoked,null);assert.equal(report.rows[0].completed,null);
  }
});
test('limits reject invalid policies and disabled policy retains legacy distinct inputs',async t=>{
  assert.deepEqual(resolveDevOptions().capture.retention,{maxPerCallable:20,maxPerGroup:2});
  for(const value of [true,null,[],0,{extra:1},{maxPerGroup:0},{maxPerGroup:21},{maxPerCallable:1001},{maxPerGroup:1.5}])assert.throws(()=>resolveDevRetention(value),/INVALID_POLICY/);
  const root=await fixture(t),retention=await loadDevRetention(root,false);
  for(let i=0;i<30;i++)assert.equal(retention.admit(candidate(observation(i))).status,'retained');
  const restored=await loadDevRetention(root,false,{snapshot:retention.snapshot()});assert.equal(restored.admit(candidate(observation(1))).status,'duplicate');
  await assert.rejects(loadDevRetention(root,{maxPerCallable:20,maxPerGroup:2},{snapshot:retention.snapshot()}),/INVALID_RETENTION_STATE/);
});
