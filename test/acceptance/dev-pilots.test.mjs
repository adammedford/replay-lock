import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { validatePilotReport, parseScan, PILOTS, stagesFor } from '../../scripts/pilot-dev-manifest.mjs';
import { seedReturnRegression, attachEpicMiddlewareHost, generateLogicMutants } from '../../scripts/pilot-dev-edit.mjs';
import { checkBudget } from '../../scripts/bench-dev.mjs';
import { compareBrowserLatency } from '../../scripts/bench-dev-browser.mjs';
const report=async phase=>JSON.parse(await readFile(new URL(`../../docs/pilots/${phase}.json`,import.meta.url),'utf8'));
const command=(id,exitCode,argv=['node','verify'])=>({id,argv,cwd:'/app',exitCode,signal:null,errorCode:null,durationMs:1,outputSha256:'a'.repeat(64),outputBytes:1,excerpt:''});
/** A synthetic schema 2 Epic pilot that completed the whole journey, for exercising the validator's mutation rules. */
function passedEpicReport(){
  const pin=PILOTS.find(p=>p.id==='epic-stack'),digest='c'.repeat(64),stamp='2026-09-26T00:00:00.000Z';
  const stages=Object.fromEntries(stagesFor(2).map((stage,index)=>[stage,{status:'passed',commandId:index}]));
  const commands=stagesFor(2).map((stage,index)=>command(index,stage==='regression'?1:0));
  return {schemaVersion:2,phase:'final',generatedAt:stamp,runnerSha256:digest,manifestSha256:digest,environment:{node:'22.19.0',platform:'darwin',arch:'arm64',timezone:'UTC',locale:'en-US'},replaylock:{tarballSha256:digest},pilots:[{
    id:pin.id,repository:pin.repository,revision:pin.revision,realm:pin.realm,status:'passed',startedAt:stamp,finishedAt:stamp,durationMs:1,data:'synthetic-local',humanReviewMs:null,reviewMode:'scripted-synthetic-only',
    packageManager:{name:pin.manager,version:pin.managerVersion},source:{verifiedRevision:pin.revision,packageJsonSha256:digest,lockfile:pin.lockfile,lockfileSha256:digest,packageJsonAfterSha256:digest,lockfileAfterSha256:digest},installedReplaylockSha256:digest,
    stages,counts:{eligibleNode:1,eligibleBrowser:1,excludedNode:0,excludedBrowser:0,observations:4,candidates:4,accepted:4,replayed:4,refactorSurvived:4,regressionsDetected:1,mutantsApplied:null,mutantsDetected:null},commands,
    scanOutput:'Scanned node: 1 eligible, 0 skipped findings\nSCAN_ELIGIBLE node x\nScanned browser: 1 eligible, 0 skipped findings\nSCAN_ELIGIBLE browser x\n',
    workflows:pin.workflows.map(id=>({id,status:'passed',assertion:'synthetic'})),blocker:null,offline:true,regressionCodes:['OUTPUT_MISMATCH'],mutation:null,
  }]};
}
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
test('committed Epic mutation evidence measures every accepted callable against seeded logic mutants',async()=>{
  const evidence=validatePilotReport(await report('epic-mutation-2026-09-27'),{requireBoth:false});
  const [epic]=evidence.pilots;
  assert.equal(evidence.schemaVersion,2);assert.equal(epic.id,'epic-stack');assert.equal(epic.status,'passed');assert.equal(epic.humanReviewMs,null);
  assert.deepEqual(epic.mutation.callables.map(entry=>[entry.callable,entry.cases,entry.applied,entry.detected]),[
    ['app/routes/_marketing/index.tsx#meta',2,1,1],['app/utils/misc.tsx#getUserImgSrc',2,3,2],['app/utils/user.ts#isUser',2,6,2],
  ]);
  assert.equal(epic.mutation.callables.reduce((sum,entry)=>sum+entry.cases,0),epic.counts.accepted,'every accepted case belongs to a measured callable');
});
test('schema 2 evidence records per-callable mutation results and rejects claims its commands do not support',async()=>{
  const v1=await report('baseline');
  assert.equal(validatePilotReport(v1).schemaVersion,1);
  // A version 2 report with an unrun mutation stage validates like version 1.
  const v2=structuredClone(v1);v2.schemaVersion=2;
  for(const pilot of v2.pilots){pilot.stages.mutation={status:'not-run',commandId:null};pilot.counts.mutantsApplied=null;pilot.counts.mutantsDetected=null;pilot.mutation=null;}
  assert.equal(validatePilotReport(v2).schemaVersion,2);
  assert.throws(()=>validatePilotReport({...structuredClone(v1),schemaVersion:2}),/mutant|mutation/);
  // Mutation evidence: one verify command per mutant, exit 1 with a mismatch for a detected mutant, exit 0 for a survivor.
  const measured=passedEpicReport();const pilot=measured.pilots[0];
  pilot.commands.push(command(90,1),command(91,0),command(92,1));
  pilot.stages.mutation={status:'passed',commandId:92};pilot.counts.mutantsApplied=3;pilot.counts.mutantsDetected=2;
  pilot.mutation={limit:12,callables:[
    {callable:'src/a.ts#isUser',cases:2,generated:2,applied:2,detected:1,mutants:[{kind:'logical',line:3,column:14,before:'&&',after:'||',commandId:90,detected:true,codes:['OUTPUT_MISMATCH']},{kind:'string',line:3,column:32,before:"'object'",after:"'object_mutant'",commandId:91,detected:false,codes:[]}]},
    {callable:'src/b.ts#meta',cases:1,generated:1,applied:1,detected:1,mutants:[{kind:'string',line:1,column:40,before:"'Epic'",after:"'Epic_mutant'",commandId:92,detected:true,codes:['OUTPUT_MISMATCH']}]},
    {callable:'src/c.ts#identity',cases:1,generated:0,applied:0,detected:0,mutants:[]},
  ]};
  assert.equal(validatePilotReport(measured,{requireBoth:false}).pilots[0].status,'passed');
  for(const [name,mutate] of [
    ['detected mutant whose verify exited 0',r=>{r.pilots[0].commands.find(c=>c.id===90).exitCode=0;}],
    ['passing pilot without the mutation stage',r=>{r.pilots[0].stages.mutation={status:'not-run',commandId:null};r.pilots[0].mutation=null;r.pilots[0].counts.mutantsApplied=null;r.pilots[0].counts.mutantsDetected=null;}],
    ['mutation measured before regression passed',r=>{r.pilots[0].stages.regression.status='failed';r.pilots[0].status='blocked';r.pilots[0].blocker={stage:'regression',code:'X',detail:'x',commandId:r.pilots[0].stages.regression.commandId,category:'workflow'};}],
    ['undetected mutant claimed detected',r=>r.pilots[0].mutation.callables[0].mutants[1].detected=true],
    ['detected mutant without a mismatch code',r=>r.pilots[0].mutation.callables[0].mutants[0].codes=[]],
    ['detected count disagrees with mutants',r=>r.pilots[0].mutation.callables[0].detected=2],
    ['summary count disagrees with callables',r=>r.pilots[0].counts.mutantsDetected=3],
    ['more applied than generated',r=>r.pilots[0].mutation.callables[1].generated=0],
    ['mutant beyond the bound',r=>r.pilots[0].mutation.limit=0],
    ['command evidence missing',r=>r.pilots[0].mutation.callables[1].mutants[0].commandId=77],
    ['more callables than accepted cases',r=>r.pilots[0].counts.accepted=2],
    ['passed stage without measured callables',r=>r.pilots[0].mutation.callables=[]],
    ['mutation results without a run stage',r=>r.pilots[0].stages.mutation={status:'not-run',commandId:null}],
    ['one verify command backing two mutants',r=>r.pilots[0].mutation.callables[1].mutants[0].commandId=90],
    ['the regression verify backing a mutant',r=>{r.pilots[0].mutation.callables[1].mutants[0].commandId=r.pilots[0].stages.regression.commandId;}],
    ['stage evidence that is not a mutant verify',r=>{r.pilots[0].stages.mutation.commandId=r.pilots[0].stages.regression.commandId;}],
    ['accepted cases outside the measured callables',r=>r.pilots[0].mutation.callables[2].cases=2],
    ['mutant without a column',r=>delete r.pilots[0].mutation.callables[1].mutants[0].column],
  ]){const copy=structuredClone(measured);mutate(copy);assert.throws(()=>validatePilotReport(copy,{requireBoth:false}),name);}
  // Scripted review keeps human review time null.
  const scripted=structuredClone(measured);scripted.pilots[0].humanReviewMs=900;assert.throws(()=>validatePilotReport(scripted,{requireBoth:false}),/no human review time/);
});
test('seeded regression changes the chosen return while evaluating its original effects and leaving other functions intact',()=>{
  const source='function other(){return 10;} export function chosen(){return Math.random()+1;}';
  const changed=seedReturnRegression(source,{module:'source.js',namePath:['chosen']},ts);assert.match(changed,/function other\(\)\{return 10;\}/);assert.match(changed,/return \(\(Math.random\(\)\+1\), void 0\)/);
  assert.equal(seedReturnRegression('export async function chosen(){return fetch("x");}',{module:'source.js',namePath:['chosen']},ts),undefined);
});
test('logic mutants each flip one operator, branch or literal of the chosen callable and leave other functions unchanged',()=>{
  const other='function other(a){return a===1&&"x";}';
  const source=`${other}\nexport function chosen(user,limit=3){\n  if(user&&typeof user==='object'){return user.id!==limit?'same':\`k=\${limit}\`;}\n  return limit<10||limit>=20?[{title:'Epic Notes'}]:null;\n}`;
  const mutants=generateLogicMutants(source,{module:'source.ts',namePath:['chosen']},ts);
  const edits=mutants.map(mutant=>`${mutant.line} ${mutant.kind}:${mutant.before}→${mutant.after}`);
  assert.deepEqual(edits,[
    '3 logical:&&→||','3 comparison:===→!==','3 string:\'object\'→\'object_mutant\'',
    '3 branch:user.id!==limit?\'same\':`k=${limit}`→user.id!==limit?`k=${limit}`:\'same\'','3 comparison:!==→===','3 string:\'same\'→\'same_mutant\'','3 string:`k=${→`k=_mutant${',
    '4 branch:limit<10||limit>=20?[{title:\'Epic Notes\'}]:null→limit<10||limit>=20?null:[{title:\'Epic Notes\'}]',
    '4 logical:||→&&','4 comparison:<→>=','4 number:10→(10 + 1)','4 comparison:>=→<','4 number:20→(20 + 1)','4 string:\'Epic Notes\'→\'Epic Notes_mutant\'',
  ]);
  for(const mutant of mutants){
    assert.ok(mutant.source.startsWith(other+'\n'),`${mutant.kind} changed another function`);
    assert.equal(mutant.source.split('\n').length,source.split('\n').length);
    assert.equal(mutant.source.split('\n')[mutant.line-1].includes(mutant.after),true);
  }
  assert.equal(mutants[3].source.split('\n')[2],"  if(user&&typeof user==='object'){return user.id!==limit?`k=${limit}`:'same';}");
  // Two mutants on one line are told apart by column.
  assert.deepEqual(mutants.filter(mutant=>mutant.kind==='logical').map(mutant=>[mutant.line,mutant.column]),[[3,10],[4,18]]);
  const numeric=generateLogicMutants('export const scale=(n)=>n*2.5;',{module:'m.ts',namePath:['scale']},ts);
  assert.deepEqual(numeric.map(mutant=>[mutant.kind,mutant.after,mutant.source]),[['number','(2.5 + 1)','export const scale=(n)=>n*(2.5 + 1);']]);
  const loose=generateLogicMutants('export const cmp=(a,b)=>[a==b,a!=b,a>b,a<=b];',{module:'m.ts',namePath:['cmp']},ts);
  assert.deepEqual(loose.map(mutant=>`${mutant.before}→${mutant.after}`),['==→!=','!=→==','>→<=','<=→>']);
  // if/else branches swap; object keys and nested named functions are left alone.
  const branches=generateLogicMutants('function f(c){function inner(){return 1;}if(c){return {1:c,"b":c,["k"]:c};}else{return inner();}}',{module:'m.ts',namePath:['f']},ts);
  assert.deepEqual(branches.map(mutant=>mutant.kind),['branch']);
  assert.equal(branches[0].source,'function f(c){function inner(){return 1;}if(c){return inner();}else{return {1:c,"b":c,["k"]:c};}}');
  // Literals in type positions are erased before verify; module specifiers are not the callable's logic.
  const erased=generateLogicMutants("export const typed=async(v:'a'|'b')=>{const k:'x'='y' as 'x';const m=await import('./m.ts');return [k,v as 'a',m,require('n')];};",{module:'m.ts',namePath:['typed']},ts);
  assert.deepEqual(erased.map(mutant=>mutant.before),["'y'"]);
  // A callable without mutable logic yields nothing rather than a pass.
  assert.deepEqual(generateLogicMutants('export const identity=(value)=>value;',{module:'m.ts',namePath:['identity']},ts),[]);
  assert.equal(generateLogicMutants(source,{module:'source.ts',namePath:['missing']},ts),undefined);
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
test('browser latency comparison requires complete successful pairs and rejects a known over-budget control',()=>{
  const report={schemaVersion:1,pairs:5,runs:[]};
  for(let pair=0;pair<5;pair++)for(const mode of ['disabled','enabled'])report.runs.push({pair,mode,status:'passed',coldPageMs:mode==='enabled'?120:100,navigationMs:mode==='enabled'?60:50,visibleHmrMs:mode==='enabled'?220:200,cleanup:{ownedGroupExited:true}});
  const limits={coldPageMs:30,navigationMs:20,visibleHmrMs:30};
  assert.equal(compareBrowserLatency(report,limits).coldPageMs.overheadMs,20);
  const missing=structuredClone(report);missing.runs.pop();assert.throws(()=>compareBrowserLatency(missing,limits),/missing paired browser runs/);
  const timeout=structuredClone(report);timeout.runs[0].status='failed';assert.throws(()=>compareBrowserLatency(timeout,limits),/did not complete/);
  const leaking=structuredClone(report);leaking.runs[0].cleanup.ownedGroupExited=false;assert.throws(()=>compareBrowserLatency(leaking,limits),/leaked/);
  const slow=structuredClone(report);for(const row of slow.runs)if(row.mode==='enabled')row.visibleHmrMs=300;
  assert.throws(()=>compareBrowserLatency(slow,limits),/overhead exceeded budget/);
});
