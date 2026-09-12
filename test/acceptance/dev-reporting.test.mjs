import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { replaylock } from '../../dist/vite-plugin.js';
import { createDevSessionReport, parseDevCounts, parseDevReport } from '../../dist/dev-report.js';
import { fixture, put, jsonFiles, control, until, library, command, digest } from '../helpers/dev-fixture.mjs';
const source=`export function roll(n) { return n + Math.random(); }
export function echo(value) { return value; }
export function unused(value) { return value + 1; }
export function blocked(value) { console.log(value); return value; }
`;
async function boundedScan(root,args=['scan','--dev','--json']) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(library,'dist/cli.js'),...args],{cwd:root,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},5000);
    child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr,timedOut});});
  });
}
test('scan disposes import-time resources and surviving plugin subprocesses', {timeout:15000}, async t=>{
  const root=await fixture(t,{
    'src/calls.js':'export function echo(value) { return value; }',
    'vite.config.mjs':`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
setInterval(()=>{},1000);
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.stdout.write('ready');"],{stdio:['ignore','pipe','ignore']});
await new Promise(resolve=>child.stdout.once('data',resolve));
writeFileSync('plugin-child.pid',String(child.pid));
export default {};`,
  });
  t.after(async()=>{try{process.kill(Number(await readFile(path.join(root,'plugin-child.pid'),'utf8')),'SIGKILL');}catch{}});
  const result=await boundedScan(root);
  assert.equal(result.timedOut,false,'import-time resources prevented scan exit');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).environments.map(e=>e.targets.length),[1,1]);
  const pid=Number(await readFile(path.join(root,'plugin-child.pid'),'utf8'));
  await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}},3000);
  await put(root,'vite.config.mjs',"setInterval(()=>{},1000);throw new Error('CONFIGURATION_FAILED');");
  const failed=await boundedScan(root);
  assert.equal(failed.timedOut,false);assert.equal(failed.status,2);
  assert.match(failed.stderr,/CONFIGURATION_FAILED/);
  await put(root,'vite.config.mjs','process.exit(0);export default {};');
  const interrupted=await boundedScan(root);
  assert.equal(interrupted.timedOut,false);
  assert.equal(interrupted.status,2,'an exit without a completed scan must not report success');
  assert.match(interrupted.stderr,/SCAN_INFRASTRUCTURE_FAILED/);
});
test('development scan closes configuration plugin resources on success and policy errors', {timeout:20000}, async t=>{
  const root=await fixture(t,{
    'src/calls.js':'export function echo(value) { return value; }',
    'vite.config.mjs':`import {appendFileSync} from 'node:fs';
let timer;
export default {plugins:[{
  name:'configuration-resource',
  config(){timer=setInterval(()=>{},1000);},
  configureServer(server){if(server.httpServer)throw new Error('SCAN_MUST_NOT_LISTEN');},
  buildEnd(){clearInterval(timer);appendFileSync('lifecycle.txt','buildEnd\\n');},
  closeBundle(){appendFileSync('lifecycle.txt','closeBundle\\n');}
}]};`,
  });
  const result=await boundedScan(root);
  assert.equal(result.timedOut,false,'scan emitted results but configuration resources prevented natural exit');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).environments.map(e=>e.targets.length),[1,1]);
  const lifecycle=await readFile(path.join(root,'lifecycle.txt'),'utf8');
  assert.match(lifecycle,/buildEnd\n/);assert.match(lifecycle,/closeBundle\n/);
  await put(root,'lifecycle.txt','');
  await put(root,'replaylock.config.mjs','export default {capture:{retention:{maxPerGroup:0}}};');
  const failed=await boundedScan(root);
  assert.equal(failed.timedOut,false,'invalid policy must still close configuration resources');
  assert.equal(failed.status,2);assert.match(failed.stderr,/INVALID_POLICY/);
  const failedLifecycle=await readFile(path.join(root,'lifecycle.txt'),'utf8');
  assert.match(failedLifecycle,/buildEnd\n/);assert.match(failedLifecycle,/closeBundle\n/);
});
test('public JSON scan and session report distinguish invocation, rejection, omission and unknown execution without values; retries count once', {timeout:60000},async t=>{
  const root=await fixture(t,{'src/calls.js':source,'index.html':'<script type="module" src="/src/main.js"></script>','src/main.js':''});
  const scan=await command(root,['scan','--dev','--json']);assert.equal(scan.status,0,scan.output);
  const parsed=JSON.parse(scan.output);assert.equal(parsed.schemaVersion,1);assert.equal(parsed.environments.length,2);
  const finding=parsed.environments.flatMap(e=>e.diagnostics).find(d=>d.locator.namePath[0]==='blocked');assert.ok(finding.position.line>0);assert.ok(finding.position.column>0);
  const server=await createServer({root,configFile:false,logLevel:'silent',plugins:[replaylock({dev:true})],server:{host:'127.0.0.1',port:0,fs:{allow:[root,library]}}});
  t.after(()=>server.close());await server.listen();
  const manifest=await until(async()=>(await jsonFiles(root,'.replaylock/dev'))[0]);const started=await control(manifest,'start');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  let countAttempts=0,observationFailed=false,failTarget;
  const nativeRename=fs.promises.rename;
  const renameMock=t.mock.method(fs.promises,'rename',async(from,to)=>{if(to===failTarget){failTarget=undefined;throw Object.assign(new Error('EIO'),{code:'EIO'});}return nativeRename(from,to);});syncBuiltinESMExports();
  t.after(()=>{renameMock.mock.restore();syncBuiltinESMExports();});
  const sidecarPath=path.join(root,'.replaylock/observations/dev-sessions',started.session,'report.json');
  await page.route('**/__replaylock/observations',async route=>{
    const payload=route.request().postDataJSON();
    if(payload.observation&&!observationFailed){
      observationFailed=true;failTarget=path.join(path.dirname(sidecarPath),'0000000001.json');const failed=await route.fetch();assert.equal(failed.status(),400,await failed.text());await route.fulfill({response:failed});
    }else if(payload.counts&&++countAttempts===1){
      failTarget=sidecarPath;
      const failed=await route.fetch();assert.equal(failed.status(),400,await failed.text());
      await route.fulfill({response:failed});
    }else if(payload.counts&&countAttempts===2){assert.equal((await route.fetch()).status(),200);await route.abort();}
    else await route.continue();
  });
  await page.goto(manifest.url);await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{const {roll,echo}=await import('/src/calls.js');for(let n=0;n<6;n++)roll(5);echo('seeded-report-value-5192');});
  await until(async()=>{const s=await control(manifest,'status');return countAttempts>=3&&s.report.rows.some(r=>r.environment==='browser'&&r.locator.namePath[0]==='roll'&&r.completed===6);});
  const calls=await server.ssrLoadModule('/src/calls.js');assert.equal(calls.echo({password:'private-report-marker'}).password,'private-report-marker');
  const stopped=await control(manifest,'stop');assert.equal(stopped.candidates,3);assert.equal(stopped.recordingBlocks,3);
  const result=await command(root,['report','--session',started.session,'--json']);assert.equal(result.status,0,result.output);
  assert.doesNotMatch(result.output,/seeded-report-value-5192|private-report-marker|password|"arguments"|"completion"|"trace"/);
  const report=JSON.parse(result.output);assert.equal(report.status,'partial');assert.equal(report.countsComplete,false);
  assert.equal(report.blocks.STORE_WRITE_FAILED,2);
  const roll=report.rows.find(r=>r.environment==='browser'&&r.locator.namePath[0]==='roll');assert.equal(roll.invoked,6);assert.equal(roll.completed,6);assert.equal(roll.retained,2);assert.equal(roll.omitted,4);assert.equal(roll.observations,6);assert.equal(roll.duplicates,0);
  const echo=report.rows.find(r=>r.environment==='node'&&r.locator.namePath[0]==='echo');assert.equal(echo.invoked,1);assert.equal(echo.completed,1);assert.equal(echo.blocks.SENSITIVE_VALUE,1);
  const unused=report.rows.find(r=>r.environment==='browser'&&r.locator.namePath[0]==='unused');assert.equal(unused.execution,'unexercised');assert.equal(unused.invoked,0);
  const blocked=report.rows.find(r=>r.environment==='browser'&&r.locator.namePath[0]==='blocked');assert.equal(blocked.execution,'unknown');assert.equal(blocked.invoked,null);
  assert.ok((await command(root,['report','--session',started.session])).output.includes('omitted=4'));
  const sidecar=JSON.parse(await readFile(path.join(root,'.replaylock/observations/dev-sessions',started.session,'report.json'),'utf8'));assert.deepEqual(sidecar,report);
});
test('count completeness never infers delivery from observations; report projection ignores arbitrary captured fields',()=>{
  const session='00000000-0000-4000-a000-000000000000',metadata={locator:{module:'a.js',kind:'export',namePath:['a']},environment:'browser',generation:'1',sourceGraphDigest:digest};
  const report=createDevSessionReport(session);report.observation(metadata,'retained');assert.equal(report.snapshot('complete').countsComplete,false);
  report.counts([{metadata,invoked:1,completed:1}]);assert.equal(report.snapshot('complete').countsComplete,true);
  report.block({code:'INCOMPLETE_OBSERVATION'});assert.equal(report.snapshot('partial').countsComplete,false);
  const injected={...report.snapshot(),arguments:'must not echo',rows:report.snapshot().rows.map(r=>({...r,result:'must not echo'}))};assert.doesNotMatch(JSON.stringify(parseDevReport(injected)),/must not echo/);
  assert.throws(()=>parseDevCounts([{metadata,invoked:-1,completed:0}]),/INVALID_REPORT/);assert.throws(()=>parseDevCounts([{metadata,invoked:1,completed:1,arguments:'sensitive'}]),/INVALID_REPORT/);
});
