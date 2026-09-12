import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import {seedReturnRegression,attachEpicMiddlewareHost} from './pilot-dev-edit.mjs';
import { PILOTS, STAGES, COUNT_KEYS, sha256, parseScan, validatePilotReport } from './pilot-dev-manifest.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const options=process.argv.slice(2),option=name=>{const i=options.indexOf(name);return i<0?undefined:options[i+1];};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function execute(argv,cwd,timeout=300000,input='',env={}){
  return new Promise(resolve=>{
    const start=performance.now(),child=spawn(argv[0],argv.slice(1),{cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,...env},detached:process.platform!=='win32'});let output='',errorCode=null;
    const stop=()=>{try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM');}catch{}};
    const timer=setTimeout(()=>{errorCode='TIMEOUT';stop();},timeout);
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',error=>errorCode=error.code??'SPAWN_FAILED');
    child.on('close',(exitCode,signal)=>{clearTimeout(timer);resolve({argv,cwd,exitCode,signal,errorCode,durationMs:performance.now()-start,outputSha256:sha256(output),outputBytes:Buffer.byteLength(output),excerpt:output.slice(-6000),output});});child.stdin.end(input);
  });
}
async function fileDigest(file){return sha256(await readFile(file));}
async function probeRecord(request){
  const {root,cli,id,output}=request;
  const child=spawn(process.execPath,[cli,'record','--','npm','run','dev'],{cwd:root,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,NODE_ENV:'development',MOCKS:'true',...(id==='epic-stack'?{DATABASE_URL:'file:./data.db?connection_limit=1'}:{})}});
  let transcript='',ended=false,status;child.stdout.on('data',d=>transcript+=d);child.stderr.on('data',d=>transcript+=d);child.on('close',code=>{ended=true;status=code;});child.on('error',error=>{ended=true;transcript+=error.code;});
  let browser;
  const result={workflows:[],observations:null,candidates:null,session:null};
  const command=async(manifest,operation)=>{const response=await fetch(`${manifest.url}__replaylock/${operation}`,{method:'POST',headers:{'Content-Type':'application/json','X-ReplayLock-Token':manifest.token},body:'{}'});const value=await response.json();if(!response.ok)throw Error(value.code);return value;};
  try{
    let manifest;const deadline=Date.now()+40000;
    while(!manifest&&!ended&&Date.now()<deadline){try{for(const name of await readdir(path.join(root,'.replaylock/dev'))){const value=JSON.parse(await readFile(path.join(root,'.replaylock/dev',name),'utf8'));if(value.launch&&Number.isSafeInteger(value.pid)&&value.pid>0&&transcript.includes(`ReplayLock attached to ${value.url}`)){try{process.kill(value.pid,0);manifest=value;}catch{}}}}catch{}if(!manifest)await pause(100);}
    if(!manifest)throw Error(/NO_ELIGIBLE_TARGET/.test(transcript)?'NO_ELIGIBLE_TARGET':'PLUGIN_NOT_ACTIVE');
    const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultNavigationTimeout(120000);
    // Workloads use only the application's bundled configuration / seeded data.
    await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost','[::1]'].includes(url.hostname)?route.continue():route.abort();});
    await page.goto(manifest.url);await page.waitForLoadState('networkidle');
    if(id==='homer'){
      await page.locator('.service').first().waitFor();result.workflows.push({id:'bundled-dashboard',status:'passed',assertion:'Bundled dashboard renders service cards.'});
      const search=page.locator('input[type="search"],input[placeholder*="Search"]').first();await search.fill('replaylock-no-service');await page.waitForTimeout(250);assert.equal(await page.locator('.service:visible').count(),0);await search.fill('');result.workflows.push({id:'service-filter',status:'passed',assertion:'Existing search filters all nonmatching services and resets.'});
      const response=await page.request.get(`${manifest.url}dummy-data/pihole.json`);assert.equal(response.status(),200);JSON.parse(await response.text());result.workflows.push({id:'local-dummy-service',status:'passed',assertion:'Existing dummy service endpoint returns local JSON.'});
    }else{
      await page.goto(`${manifest.url}users?search=kody`);await page.getByRole('link',{name:/kody/i}).first().waitFor();result.workflows.push({id:'seeded-user-search',status:'passed',assertion:'Existing search finds seeded user kody.'});
      await page.goto(`${manifest.url}users?search=replaylock-no-user`);assert.equal(await page.getByRole('link',{name:/kody/i}).count(),0);result.workflows.push({id:'missing-user-search',status:'passed',assertion:'Existing search excludes a nonexistent username.'});
      await page.goto(`${manifest.url}users/kody`);await page.locator('a[href="/users/kody/notes"]').waitFor();result.workflows.push({id:'profile-navigation',status:'passed',assertion:'Seeded profile renders a notes link.'});await page.locator('a[href="/users/kody/notes"]').click();await page.waitForURL(/notes/);result.workflows.push({id:'notes-navigation',status:'passed',assertion:'Existing notes navigation reaches seeded notes.'});
    }
    const stopped=await command(manifest,'stop');result.observations=stopped.observations;result.candidates=stopped.candidates;result.session=stopped.session;result.recordingBlocks=stopped.recordingBlocks;
    assert.ok(stopped.candidates>0,'NO_WORKFLOW_CANDIDATES');assert.equal(stopped.recordingBlocks,0,'PARTIAL_CAPTURE');
    await writeFile(output,JSON.stringify(result));console.log('PILOT WORKLOAD RECORDED');
  }catch(error){await writeFile(path.join(path.dirname(output),'record-startup.log'),transcript);await writeFile(output,JSON.stringify({...result,code:error.message}));console.error(transcript.slice(-5000));console.error(error.message);process.exitCode=2;}
  finally{if(browser)await browser.close();try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM');}catch{}for(let n=0;n<20&&!ended;n++)await pause(100);}
}
async function runPilot(pin,settings){
  const startedAt=new Date().toISOString(),start=performance.now(),temporary=await realpath(await mkdtemp(path.join(tmpdir(),`replaylock-${pin.id}-`))),root=path.join(temporary,'app'),consumer=path.join(temporary,'consumer');
  const result={id:pin.id,repository:pin.repository,revision:pin.revision,realm:pin.realm,status:'blocked',startedAt,finishedAt:startedAt,durationMs:0,data:'synthetic-local',humanReviewMs:null,reviewMode:'scripted-synthetic-only',packageManager:{name:pin.manager,version:pin.managerVersion},source:{},stages:Object.fromEntries(STAGES.map(s=>[s,{status:'not-run',commandId:null}])),counts:Object.fromEntries(COUNT_KEYS.map(k=>[k,null])),commands:[],workflows:[],blocker:null,offline:false,regressionCodes:[]};
  let stage='checkout';
  const run=async(argv,cwd=root,timeout=300000,input='',env={})=>{const evidence=await execute(argv,cwd,timeout,input,env);const {output,...record}=evidence;record.id=result.commands.length;result.commands.push(record);result.stages[stage]={status:evidence.exitCode===0&&!evidence.errorCode&&!evidence.signal?'passed':'failed',commandId:record.id};if(evidence.exitCode!==0||evidence.errorCode||evidence.signal)throw Object.assign(Error(evidence.errorCode??'COMMAND_FAILED'),{evidence:record});return evidence;};
  try{
    await mkdir(root);await run(['git','init',root],temporary);await run(['git','remote','add','origin',pin.repository]);
    const remote=settings.sourceCache?path.join(settings.sourceCache,pin.id):'origin';await run(['git','fetch','--depth','1',remote,pin.revision]);await run(['git','checkout','--detach',pin.revision]);
    const revision=await run(['git','rev-parse','HEAD']);assert.equal(revision.output.trim(),pin.revision);
    result.source={verifiedRevision:revision.output.trim(),packageJsonSha256:await fileDigest(path.join(root,'package.json')),lockfile:pin.lockfile,lockfileSha256:await fileDigest(path.join(root,pin.lockfile))};
    stage='install';
    const environment={npm_config_cache:settings.npmCache,COREPACK_HOME:settings.corepackCache,CI:'true'};
    const version=await run([pin.manager,'--version'],root,60000,'',environment);assert.deepEqual(version.output.split(/\r?\n/).filter(line=>/^\d+\.\d+\.\d+$/.test(line)),[pin.managerVersion]);
    await run(pin.manager==='pnpm'?['pnpm','install','--frozen-lockfile']:['npm','ci','--no-audit','--no-fund'],root,300000,'',environment);
    if(pin.id==='epic-stack'){
      await writeFile(path.join(root,'.env'),await readFile(path.join(root,'.env.example')));
      await writeFile(path.join(root,'prisma/data.db'),'',{flag:'wx'});
      const localEnvironment={...environment,PATH:path.join(root,'node_modules/.bin')+path.delimiter+process.env.PATH,DATABASE_URL:'file:./data.db?connection_limit=1',MOCKS:'true'};
      const prisma=path.join(root,'node_modules/prisma/build/index.js');
      await run([process.execPath,prisma,'migrate','deploy'],root,120000,'',localEnvironment);
      await run([process.execPath,prisma,'generate','--sql'],root,120000,'',localEnvironment);
      await run([process.execPath,prisma,'db','seed'],root,120000,'',localEnvironment);
      const hostFile=path.join(root,'server/index.ts');const before=await readFile(hostFile,'utf8');const after=attachEpicMiddlewareHost(before);
      await writeFile(hostFile,after);
      result.hostIntegration={kind:'vite-middleware-parent-server',path:'server/index.ts',beforeSha256:sha256(before),afterSha256:sha256(after)};
    }
    await mkdir(consumer);await writeFile(path.join(consumer,'package.json'),'{"name":"replaylock-pilot-consumer","private":true}');
    await run(['npm','install','--legacy-peer-deps','--no-audit','--no-fund','--ignore-scripts',settings.tarball],consumer,300000,'',environment);
    const installed=path.join(consumer,'node_modules/replaylock');await symlink(installed,path.join(root,'node_modules/replaylock'),process.platform==='win32'?'junction':'dir');result.installedReplaylockSha256=settings.tarballSha256;
    // Preserve config-relative paths and all application dependency declarations.
    const original=pin.config.replace('.config.','.pilot-original.config.');await writeFile(path.join(root,original),await readFile(path.join(root,pin.config)));
    await writeFile(path.join(root,pin.config),`import base from './${original}';import {replaylock} from 'replaylock/vite';export default async env=>{const config=typeof base==='function'?await base(env):await base;return {...config,plugins:[...(config.plugins??[]),replaylock({dev:true})],server:{...config.server,host:'127.0.0.1',fs:{allow:[${JSON.stringify(root)},${JSON.stringify(consumer)}]}}};};`);
    const cli=path.join(installed,'dist/cli.js');stage='scan';const scan=await run([process.execPath,cli,'scan','--dev'],root,120000);result.scanOutput=scan.output;const counts=parseScan(scan.output);
    for(const [realm,suffix]of [['node','Node'],['browser','Browser']]){result.counts[`eligible${suffix}`]=counts[realm].eligible;result.counts[`excluded${suffix}`]=counts[realm].excluded;}
    stage='record';const captureOutput=path.join(temporary,'capture.json');const request=path.join(temporary,'capture-request.json');await writeFile(request,JSON.stringify({root,cli,id:pin.id,output:captureOutput}));
    await run([process.execPath,fileURLToPath(import.meta.url),'--record-probe',request],root,300000);
    const captured=JSON.parse(await readFile(captureOutput,'utf8'));Object.assign(result.counts,{observations:captured.observations,candidates:captured.candidates});result.workflows=captured.workflows;result.stages.workload={...result.stages.record};
    stage='review';await run([process.execPath,cli,'review'],root,60000,'a\n'.repeat(captured.candidates));result.counts.accepted=(await readdir(path.join(root,'.replaylock/cases'))).length;
    // Native network during replay fails explicitly, while loopback serves Vitest.
    const guard=path.join(temporary,'offline.mjs');await writeFile(guard,`import http from 'node:http';import https from 'node:https';import net from 'node:net';const fail=()=>{throw Error('PILOT_OFFLINE_NETWORK')};globalThis.fetch=fail;https.request=fail;https.get=fail;const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const first=args[0];const host=typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:undefined;if(host&&!['localhost','127.0.0.1','::1'].includes(host))fail();return connect.apply(this,args);};`);
    const replayEnv={NODE_OPTIONS:`--import=${guard}`};stage='offlineReplay';await run([process.execPath,cli,'verify'],root,300000,'',replayEnv);result.offline=true;result.counts.replayed=result.counts.accepted;
    const cases=await Promise.all((await readdir(path.join(root,'.replaylock/cases'))).map(async file=>JSON.parse(await readFile(path.join(root,'.replaylock/cases',file),'utf8'))));const module=path.join(root,cases[0].locator.module),before=await readFile(module,'utf8');await writeFile(module,'// Behavior-preserving pilot edit\n'+before);
    stage='refactorReplay';await run([process.execPath,cli,'verify'],root,300000,'',replayEnv);result.counts.refactorSurvived=result.counts.replayed;
    stage='regression';
    let edited=false;
    for(const artifact of cases){
      if(artifact.completion.kind!=='return'||artifact.completion.value.kind==='undefined')continue;
      const file=path.join(root,artifact.locator.module),text=await readFile(file,'utf8'),changed=seedReturnRegression(text,artifact.locator,ts);
      if(changed){await writeFile(file,changed);edited=true;break;}
    }
    if(!edited)throw Error('NO_SUPPORTED_REGRESSION_EDIT');
    const changed=await execute([process.execPath,cli,'verify'],root,300000,'',replayEnv);const {output,...record}=changed;record.id=result.commands.length;result.commands.push(record);result.stages.regression={status:'failed',commandId:record.id};assert.equal(changed.exitCode,1);assert.match(output,/OUTPUT_MISMATCH/);result.stages.regression.status='passed';result.regressionCodes=['OUTPUT_MISMATCH'];result.counts.regressionsDetected=1;result.status='passed';
  }catch(error){
    if(stage==='record'){
      try {
        const probe=JSON.parse(await readFile(path.join(temporary,'capture.json'),'utf8'));
        result.workflows=probe.workflows;
        result.recordingProbe=probe;
        for(const key of ['observations','candidates'])if(probe[key]===0)result.counts[key]=0;
        if(/^[A-Z][A-Z_]+$/.test(probe.code??''))error.message=probe.code;
      }catch{}
    }
    const last=result.commands.at(-1);result.stages[stage]={status:'failed',commandId:last?.id??null};const excerpt=last?.excerpt??'';const code=/NO_ELIGIBLE_TARGET/.test(excerpt)?'NO_ELIGIBLE_TARGET':/INSTRUMENTATION_UNSUPPORTED/.test(excerpt)?'INSTRUMENTATION_UNSUPPORTED':/PLUGIN_NOT_ACTIVE/.test(excerpt)?'PLUGIN_NOT_ACTIVE':error.message;
    result.blocker={stage,code,detail:`${error.message}\n${excerpt.slice(-1900)}`,commandId:last?.id??null,category:/ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(excerpt)?'transport':stage==='install'||stage==='checkout'?'prerequisite':stage==='scan'||stage==='record'?'compatibility':'workflow'};
  }finally{
    if(result.source.packageJsonSha256){result.source.packageJsonAfterSha256=await fileDigest(path.join(root,'package.json'));result.source.lockfileAfterSha256=await fileDigest(path.join(root,pin.lockfile));}
    result.finishedAt=new Date().toISOString();result.durationMs=performance.now()-start;
    if(options.includes('--keep-workspace'))result.diagnosticWorkspace=temporary;
    else await rm(temporary,{recursive:true,force:true});
  }
  return result;
}
if(option('--record-probe'))await probeRecord(JSON.parse(await readFile(option('--record-probe'),'utf8')));
else if(option('--validate')){validatePilotReport(JSON.parse(await readFile(option('--validate'),'utf8')));console.log('PILOT EVIDENCE VALIDATED');}
else{
  const phase=option('--phase'),tarball=path.resolve(option('--tarball')??''),output=path.resolve(option('--output')??`docs/pilots/${phase}.json`),selected=option('--pilot')??'all';assert.ok(['baseline','final'].includes(phase),'--phase baseline|final is required');assert.match(process.versions.node,/^22\./);
  const tarballSha256=await fileDigest(tarball);const report={schemaVersion:1,phase,generatedAt:new Date().toISOString(),runnerSha256:sha256(Buffer.concat(await Promise.all([fileURLToPath(import.meta.url),fileURLToPath(new URL('./pilot-dev-edit.mjs',import.meta.url))].map(file=>readFile(file))))),manifestSha256:await fileDigest(new URL('./pilot-dev-manifest.mjs',import.meta.url)),environment:{node:process.versions.node,platform:process.platform,arch:process.arch,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:Intl.DateTimeFormat().resolvedOptions().locale},replaylock:{tarballSha256},pilots:[]};
  const cache=path.resolve('.unlazy/dev-usability/pilot-cache');await mkdir(cache,{recursive:true});
  for(const pin of PILOTS.filter(p=>selected==='all'||selected===p.id)){console.log(`Pilot ${phase}: ${pin.id} ${pin.revision}`);const result=await runPilot(pin,{tarball,tarballSha256,sourceCache:option('--source-cache')&&path.resolve(option('--source-cache')),npmCache:path.join(cache,'npm'),corepackCache:path.join(cache,'corepack')});report.pilots.push(result);console.log(`${pin.id}: ${result.status}${result.blocker?` at ${result.blocker.stage}: ${result.blocker.code}`:''}`);}
  await mkdir(path.dirname(output),{recursive:true});await writeFile(`${output}.partial`,JSON.stringify(report,null,2)+'\n');validatePilotReport(report,{requireBoth:selected==='all'});await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(`${output}.partial`,{force:true});console.log('PILOT EVIDENCE VALIDATED');
}
