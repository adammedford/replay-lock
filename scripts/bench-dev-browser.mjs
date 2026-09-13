import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {cpus} from 'node:os';
import {readFile,writeFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const metrics=['coldPageMs','navigationMs','visibleHmrMs'];
const originalTitle='<h1 className="text-h1">Epic Notes Users</h1>';
const changedTitle='<h1 className="text-h1">Epic Notes Users Benchmark</h1>';
const pluginText=',replaylock({dev:true})';

/** Validate the evidence shape before calculating overhead; a timeout is never a latency sample. */
export function compareBrowserLatency(report,limits){
  assert.equal(report.schemaVersion,1);
  assert.equal(report.pairs,5);
  assert.equal(report.runs.length,10,'missing paired browser runs');
  const result={};
  for(const metric of metrics){
    const samples={disabled:[],enabled:[]};
    for(let pair=0;pair<5;pair++)for(const mode of ['disabled','enabled']){
      const rows=report.runs.filter(row=>row.pair===pair&&row.mode===mode);
      assert.equal(rows.length,1,`missing or duplicate ${mode} pair ${pair}`);
      const row=rows[0];assert.equal(row.status,'passed',`${mode} pair ${pair} did not complete`);
      assert.ok(Number.isFinite(row[metric])&&row[metric]>0,`invalid ${metric}`);
      assert.equal(row.cleanup?.ownedGroupExited,true,`leaked ${mode} process group`);
      samples[mode].push(row[metric]);
    }
    const disabled=median(samples.disabled),enabled=median(samples.enabled);
    const overheadMs=enabled-disabled,ratio=enabled/disabled;
    result[metric]={disabledMedianMs:disabled,enabledMedianMs:enabled,overheadMs,ratio};
    if(limits){
      assert.ok(Number.isFinite(limits[metric])&&limits[metric]>=0,`missing ${metric} limit`);
      assert.ok(overheadMs<=limits[metric],`${metric} overhead exceeded budget: ${overheadMs} > ${limits[metric]}`);
    }
  }
  return result;
}

async function unusedPort(){
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function acceptsConnections(port){
  return new Promise(resolve=>{
    const socket=connect(port,'127.0.0.1');
    socket.once('connect',()=>{socket.destroy();resolve(true);});
    socket.once('error',()=>{socket.destroy();resolve(false);});
  });
}
async function manifestFor(root,port){
  try{
    for(const name of await readdir(path.join(root,'.replaylock/dev'))){
      if(!name.endsWith('.json'))continue;
      const value=JSON.parse(await readFile(path.join(root,'.replaylock/dev',name),'utf8'));
      if(new URL(value.url).port===String(port)&&value.pid>0){try{process.kill(value.pid,0);return value;}catch{}}
    }
  }catch{}
}
async function control(manifest,operation){
  const response=await fetch(`${manifest.url}__replaylock/${operation}`,{method:'POST',headers:{'Content-Type':'application/json','X-ReplayLock-Token':manifest.token},body:'{}',signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw Error(result.code);return result;
}
async function runOnce(root,mode,pair,configOriginal,routeOriginal){
  const configFile=path.join(root,'vite.config.ts'),routeFile=path.join(root,'app/routes/users/index.tsx');
  const port=await unusedPort();let child,browser,manifest,routeChanged=false;
  let transcript='',exitCode=null;
  const row={pair,mode,status:'failed',port};
  try{
    await writeFile(configFile,mode==='enabled'?configOriginal:configOriginal.replace(pluginText,''));
    // Each trial starts Vite with a cold dependency cache and a fresh browser.
    await rm(path.join(root,'node_modules/.vite'),{recursive:true,force:true});
    child=spawn(process.execPath,['index.ts'],{cwd:root,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),MOCKS:'true',DATABASE_URL:'file:./data.db?connection_limit=1',PATH:path.join(root,'node_modules/.bin')+path.delimiter+process.env.PATH}});
    const append=data=>{transcript=(transcript+data).slice(-65536);};
    child.stdout.on('data',append);child.stderr.on('data',append);child.on('exit',code=>{exitCode=code??2;});
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      if(exitCode!==null)throw Error(`application exited ${exitCode}`);
      if(await acceptsConnections(port))break;
      await pause(200);
    }
    if(Date.now()>=deadline)throw Error('STARTUP_TIMEOUT');
    if(mode==='enabled'){
      const until=Date.now()+10000;
      while(!(manifest=await manifestFor(root,port))&&Date.now()<until)await pause(100);
      if(!manifest)throw Error('PLUGIN_NOT_ACTIVE');
      await control(manifest,'start');
    }
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultNavigationTimeout(150000);
    let began=performance.now();await page.goto(`http://127.0.0.1:${port}/`);await page.locator('body').waitFor();row.coldPageMs=performance.now()-began;
    began=performance.now();await page.goto(`http://127.0.0.1:${port}/users?search=kody`);await page.getByRole('heading',{name:'Epic Notes Users'}).waitFor();row.navigationMs=performance.now()-began;
    began=performance.now();await writeFile(routeFile,routeOriginal.replace(originalTitle,changedTitle));routeChanged=true;
    await page.getByRole('heading',{name:'Epic Notes Users Benchmark'}).waitFor({timeout:60000});row.visibleHmrMs=performance.now()-began;
    if(manifest){const stopped=await control(manifest,'stop');row.recordingBlocks=stopped.recordingBlocks;}
    row.status='passed';
  }catch(error){row.error=String(error.message??error);row.outputTail=transcript.slice(-4000);}
  finally{
    if(routeChanged)await writeFile(routeFile,routeOriginal);
    if(browser)await browser.close();
    if(child?.pid){
      const active=()=>{if(process.platform==='win32')return exitCode===null;try{process.kill(-child.pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
      const stop=signal=>{if(!active())return;try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
      stop('SIGTERM');
      const deadline=Date.now()+10000;
      while(active()&&Date.now()<deadline)await pause(50);
      if(active())stop('SIGKILL');
      const forced=Date.now()+5000;while(active()&&Date.now()<forced)await pause(50);
      row.cleanup={ownedGroupExited:!active()};
    }
    else row.cleanup={ownedGroupExited:true};
    await writeFile(configFile,configOriginal);
  }
  return row;
}

export async function benchmarkBrowserLatency({root,output}){
  assert.match(process.versions.node,/^22\./);
  root=await realpath(root);output=path.resolve(output);
  const configFile=path.join(root,'vite.config.ts'),routeFile=path.join(root,'app/routes/users/index.tsx');
  const configOriginal=await readFile(configFile,'utf8'),routeOriginal=await readFile(routeFile,'utf8');
  assert.ok(configOriginal.includes(pluginText),'expected pinned plugin wrapper');
  assert.equal(routeOriginal.split(originalTitle).length,2,'visible HMR target changed');
  const sourceRevision=await new Promise((resolve,reject)=>{const child=spawn('git',['rev-parse','HEAD'],{cwd:root});let output='';child.stdout.on('data',d=>output+=d);child.on('close',code=>code===0?resolve(output.trim()):reject(Error('source revision unavailable')));});
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),pairs:5,sourceRevision,measurement:'cold browser page, seeded search navigation, edit to visible HMR update',cachePolicy:'remove Vite dependency cache before each fresh server and browser',environment:{node:process.versions.node,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},runnerSha256:sha256(await readFile(fileURLToPath(import.meta.url))),source:{packageJsonSha256:sha256(await readFile(path.join(root,'package.json'))),lockfileSha256:sha256(await readFile(path.join(root,'package-lock.json')))},runs:[]};
  try{
    for(let pair=0;pair<5;pair++)for(const mode of pair%2?['enabled','disabled']:['disabled','enabled']){
      console.log(`Browser pair ${pair+1}/5 ${mode}`);
      const row=await runOnce(root,mode,pair,configOriginal,routeOriginal);report.runs.push(row);
      await writeFile(`${output}.partial`,JSON.stringify(report,null,2)+'\n');
    }
    report.comparison=compareBrowserLatency(report);
    await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(`${output}.partial`,{force:true});return report;
  }finally{await writeFile(configFile,configOriginal);await writeFile(routeFile,routeOriginal);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  if(option('--check')){
    const report=JSON.parse(await readFile(option('--check'),'utf8'));
    const limits=JSON.parse(option('--limits')??'null');
    console.log(JSON.stringify(compareBrowserLatency(report,limits)));console.log('BROWSER LATENCY EVIDENCE VALIDATED');
  }else{
    assert.ok(option('--app-root'),'--app-root prepared Epic checkout is required');
    await benchmarkBrowserLatency({root:option('--app-root'),output:option('--output')??'docs/pilots/browser-latency.json'});
  }
}
