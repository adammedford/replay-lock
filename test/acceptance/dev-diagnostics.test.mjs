import assert from 'node:assert/strict';
import test from 'node:test';
import { diffDevValues, diffDevCompletions, describeDevCompletionDifference, describeDevTraceDifference } from '../../dist/dev-diff.js';
import { replayDevTrace, devEffect } from '../../dist/dev-runtime.js';
import { encodeDevValue } from '../../dist/dev-values.js';
const identity={locator:{module:'src/math.js',kind:'export',namePath:['calculate']},environment:'node',caseId:'a'.repeat(64)};
const value=encodeDevValue;
test('completion explanations share exact and tolerance comparisons at the first differing nested path',()=>{
  assert.deepEqual(diffDevValues(value({items:[1,{total:2}]}),value({items:[1,{total:3}]})),{path:'$.items[1].total',expected:'2',actual:'3'});
  assert.equal(diffDevValues(value([1,2]),value([1,2.01]),{kind:'tolerance',epsilon:0.02}),undefined);
  assert.ok(diffDevValues(value([1,2]),value([1,2.03]),{kind:'tolerance',epsilon:0.02}));
  assert.equal(diffDevCompletions({kind:'return',value:value(1)},{kind:'throw',value:value(1)}).path,'$.kind');
  const artifact={...identity,comparison:'exact',completion:{kind:'return',value:value({items:[4]})}};
  assert.match(describeDevCompletionDifference(artifact,{kind:'return',value:{items:[5]}}),/OUTPUT_MISMATCH.*math.js#calculate.*realm=node.*path \$\.value.items\[0\]; expected 4; actual 5/);
  assert.match(describeDevCompletionDifference(artifact,{kind:'return',value:{password:'no-echo'}}),/value unavailable/);
  assert.doesNotMatch(describeDevCompletionDifference(artifact,{kind:'return',value:{password:'no-echo'}}),/no-echo|password/);
  const long={...identity,comparison:'exact',completion:{kind:'return',value:value('a'.repeat(500))}};assert.ok(describeDevCompletionDifference(long,{kind:'return',value:'b'.repeat(500)}).length<1000);
});
test('trace explanations identify arguments, missing/additional effects, operations and caught mismatches without calling native effects',async()=>{
  const trace=[{kind:'call',id:0,operation:'fs.readFileSync',arguments:value(['a.txt'])},{kind:'return',id:0,value:value('recorded')}];
  const offline=()=>{assert.fail('native effect invoked during replay');};
  for(const [run,expected] of [
    [frame=>devEffect(frame,'fs.readFileSync',['b.txt'],offline),/trace\[0\].*fs.readFileSync.*\$\.arguments\[0\].*a.txt.*b.txt/],
    [()=>undefined,/trace\[0\].*missing effect/],
    [frame=>devEffect(frame,'Date.now',[],offline),/expected operation fs.readFileSync; actual operation Date.now/],
    [frame=>{try{devEffect(frame,'fs.readFileSync',['b.txt'],offline);}catch{}return 'caught';},/arguments\[0\]/],
    [frame=>devEffect(frame,'fs.readFileSync',[{password:'do-not-display'}],offline),/arguments unavailable/],
  ]) await assert.rejects(replayDevTrace(trace,run),error=>{const message=describeDevTraceDifference(identity,error.difference);assert.match(message,expected);assert.doesNotMatch(message,/do-not-display|password/);return error.code==='TRACE_MISMATCH';});
  await assert.rejects(replayDevTrace([],frame=>devEffect(frame,'Math.random',[],offline)),error=>{assert.match(describeDevTraceDifference(identity,error.difference),/trace\[0\].*additional effect/);return true;});
});
