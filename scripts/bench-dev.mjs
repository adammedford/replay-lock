import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
export const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
export function checkBudget(report){
  assert.equal(report.schemaVersion,1);assert.equal(report.pairs,5);assert.match(report.baseline.sha256,/^[a-f0-9]{64}$/);assert.match(report.final.sha256,/^[a-f0-9]{64}$/);
  assert.notEqual(report.baseline.sha256,report.final.sha256);
  for(const phase of ['baseline','final'])for(const size of [1,10,100,...(report.extended?[1000]:[])]){
    const rows=report.runs.filter(r=>r.phase===phase&&r.kind==='replay'&&r.size===size);assert.equal(rows.length,5,'incomplete replay pairs');assert.equal(new Set(rows.map(r=>r.pair)).size,5);
    for(const row of rows){assert.ok(Number.isFinite(row.replayMs)&&row.replayMs>0);assert.ok(Number.isFinite(row.peakKiB)&&row.peakKiB>0);assert.ok(row.processes>=size+1);}
  }
  for(const phase of ['baseline','final'])for(const size of [10,100,1000]){
    const rows=report.runs.filter(r=>r.phase===phase&&r.kind==='load'&&r.size===size);assert.equal(rows.length,5);assert.equal(new Set(rows.map(r=>r.pair)).size,5);
    for(const row of rows)for(const key of ['coldLoadMs','editToReadyMs','peakKiB'])assert.ok(Number.isFinite(row[key])&&row[key]>0);
  }
  const load=(phase,size)=>median(report.runs.filter(r=>r.phase===phase&&r.kind==='load'&&r.size===size).map(r=>r.coldLoadMs));
  const large={baseline:load('baseline',1000),final:load('final',1000)},small={baseline:load('baseline',10),final:load('final',10)};
  assert.ok(large.final<=large.baseline*0.5,`1000-module improvement below 50%: ${JSON.stringify(large)}`);
  assert.ok(small.final-small.baseline<=Math.max(20,small.baseline*0.1),`10-module regression exceeded budget: ${JSON.stringify(small)}`);
  return {large,small,improvementPercent:100*(1-large.final/large.baseline)};
}
async function run(argv,{cwd=repo,output}={}){
  await new Promise((resolve,reject)=>{const child=spawn(argv[0],argv.slice(1),{cwd,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>text+=d);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`${argv[0]} exited ${code}: ${text.slice(-4000)}`)));});
  if(output)return JSON.parse(await readFile(output,'utf8'));
}
export async function benchmark({baseline,final,output,extended=false}){
  assert.match(process.versions.node,/^22\./);assert.ok(baseline&&final,'--baseline and --final packed tarballs are required');
  const temporary=await mkdtemp(path.join(tmpdir(),'replaylock-bench-pair-'));
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),pairs:5,extended,measurement:'analysis plus all source transforms; edit through changed module transform; serial fresh-process replay',environment:{node:process.versions.node,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},runnerSha256:digest(await readFile(new URL('./bench-dev-worker.mjs',import.meta.url))),baseline:{sha256:digest(await readFile(baseline))},final:{sha256:digest(await readFile(final))},runs:[]};
  await mkdir(path.dirname(path.resolve(output)),{recursive:true});
  try{
    for(const [phase,tarball] of [['baseline',baseline],['final',final]]){const directory=path.join(temporary,phase);await mkdir(directory);await run(['tar','-xzf',path.resolve(tarball),'-C',directory]);await symlink(path.join(repo,'node_modules'),path.join(directory,'package/node_modules'),process.platform==='win32'?'junction':'dir');}
    for(let pair=0;pair<5;pair++)for(const kind of ['load','replay'])for(const size of kind==='load'?[10,100,1000]:extended?[1,10,100,1000]:[1,10,100])for(const phase of pair%2?['final','baseline']:['baseline','final']){
      const resultFile=path.join(temporary,'result.json'),requestFile=path.join(temporary,'request.json');await writeFile(requestFile,JSON.stringify({package:path.join(temporary,phase,'package'),kind,size,output:resultFile}));
      console.log(`Benchmark pair ${pair+1}/5 ${phase} ${kind} ${size}`);
      const measured=await run([process.execPath,path.join(repo,'scripts/bench-dev-worker.mjs'),requestFile],{output:resultFile});report.runs.push({pair,phase,...measured});await writeFile(`${output}.partial`,JSON.stringify(report,null,2)+'\n');
    }
    report.budget=checkBudget(report);await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(`${output}.partial`,{force:true});return report;
  }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(option('--check')){console.log(JSON.stringify(checkBudget(JSON.parse(await readFile(option('--check'),'utf8')))));console.log('DEV PERFORMANCE BUDGET PASSED');}
  else{await benchmark({baseline:option('--baseline'),final:option('--final'),output:option('--output')??'.unlazy/dev-usability/benchmarks/results.json',extended:args.includes('--extended')});console.log('DEV PERFORMANCE BUDGET PASSED');}
}
