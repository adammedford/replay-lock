import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { validatePilotReport, parseScan } from '../../scripts/pilot-dev-manifest.mjs';
import { seedReturnRegression, attachEpicMiddlewareHost } from '../../scripts/pilot-dev-edit.mjs';
import { checkBudget } from '../../scripts/bench-dev.mjs';
const report=async phase=>JSON.parse(await readFile(new URL(`../../docs/pilots/${phase}.json`,import.meta.url),'utf8'));
test('pilot host integration preserves application logic and rejects changed source',()=>{
  const source="const app = express()\nconst vite = createServer({server: { middlewareMode: true }})\nconst server = app.listen(portToUse, () => { console.log('ready') })";
  const changed=attachEpicMiddlewareHost(source);
  assert.match(changed,/middlewareMode: \{ server: replaylockPilotHttpServer \}/);
  assert.match(changed,/hmr: \{ server: replaylockPilotHttpServer \}/);
  assert.match(changed,/listen\(portToUse, '127.0.0.1'/);
  assert.match(changed,/console.log\('ready'\)/);
  assert.throws(()=>attachEpicMiddlewareHost(changed),/PILOT_HOST_SOURCE_CHANGED/);
  assert.throws(()=>attachEpicMiddlewareHost(source.replace('middlewareMode: true','middlewareMode: false')),/PILOT_HOST_SOURCE_CHANGED/);
});
test('committed baseline and final pilots contain pinned, consistent measured evidence',async()=>{
  for(const phase of ['baseline','final']){const evidence=validatePilotReport(await report(phase));assert.equal(evidence.phase,phase);assert.equal(evidence.pilots.length,2);for(const pilot of evidence.pilots)assert.equal(pilot.humanReviewMs,null);}
});
test('pilot validation rejects fabricated success, unperformed counts, changed application dependencies and baseline drift',async()=>{
  const evidence=await report('baseline');
  for(const mutate of [r=>r.replaylock.tarballSha256='b'.repeat(64),r=>r.pilots[0].status='passed',r=>r.pilots[0].counts.replayed=1,r=>r.pilots[0].revision='0'.repeat(40),r=>r.pilots[0].source.lockfileAfterSha256='f'.repeat(64)]){const copy=structuredClone(evidence);mutate(copy);assert.throws(()=>validatePilotReport(copy));}
  assert.throws(()=>parseScan('Scanned node: 2 eligible, 0 skipped findings\nScanned browser: 0 eligible, 0 skipped findings'),/summary disagrees/);
});
test('seeded regression changes the chosen return while evaluating its original effects and leaving other functions intact',()=>{
  const source='function other(){return 10;} export function chosen(){return Math.random()+1;}';
  const changed=seedReturnRegression(source,{module:'source.js',namePath:['chosen']},ts);assert.match(changed,/function other\(\)\{return 10;\}/);assert.match(changed,/return \(\(Math.random\(\)\+1\), void 0\)/);
  assert.equal(seedReturnRegression('export async function chosen(){return fetch("x");}',{module:'source.js',namePath:['chosen']},ts),undefined);
});
test('timing budget oracle requires complete pairs and fails a known slow control without running timings in correctness CI',()=>{
  const fixture={schemaVersion:1,pairs:5,baseline:{sha256:'a'.repeat(64)},final:{sha256:'b'.repeat(64)},runs:[]};
  for(let pair=0;pair<5;pair++)for(const phase of ['baseline','final']){
    for(const size of [10,100,1000])fixture.runs.push({pair,phase,kind:'load',size,coldLoadMs:phase==='baseline'?100:40,editToReadyMs:1,peakKiB:100});
    for(const size of [1,10,100])fixture.runs.push({pair,phase,kind:'replay',size,replayMs:10,peakKiB:100,processes:size+1});
  }
  assert.equal(checkBudget(fixture).improvementPercent,60);
  const incomplete=structuredClone(fixture);incomplete.runs.pop();assert.throws(()=>checkBudget(incomplete));
  const slow=structuredClone(fixture);for(const row of slow.runs)if(row.phase==='final'&&row.kind==='load'&&row.size===1000)row.coldLoadMs=80;assert.throws(()=>checkBudget(slow),/below 50%/);
  const small=structuredClone(fixture);for(const row of small.runs)if(row.phase==='final'&&row.kind==='load'&&row.size===10)row.coldLoadMs=130;assert.throws(()=>checkBudget(small),/regression exceeded/);
});
