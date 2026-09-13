import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createDevProjectCache } from '../dist/dev-transform.js';
import { resolveDevOptions } from '../dist/dev-options.js';
import * as api from '../dist/dev-runtime.js';
import { generatedProgram, evaluatePrograms, evaluateFaults } from './dev-conformance-programs.mjs';
export async function runConformance({seed,count=32,realm='both'}={}){
  if(!Number.isSafeInteger(count)||count<1||count>1000||seed!==undefined&&(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)||!['node','browser','both'].includes(realm))throw Error('invalid conformance options');
  const root=await mkdtemp(path.join(tmpdir(),'replaylock-conformance-'));
  const programs=Array.from({length:seed===undefined?count:1},(_,i)=>generatedProgram(seed??i));
  let server,browser;
  try{
    await writeFile(path.join(root,'package.json'),'{"type":"module"}');await mkdir(path.join(root,'src'));
    for(const p of programs)await writeFile(path.join(root,'src',`${p.seed}.js`),p.code);
    const options=resolveDevOptions(),cache=createDevProjectCache(root,options),result={schemaVersion:1,seeds:programs.map(p=>p.seed),realms:{}};
    for(const environment of realm==='both'?['node','browser']:[realm]){
      let runtimeImport=new URL('../dist/dev-runtime.js',import.meta.url).href;
      if(environment==='browser'){
        const content=new Map([['/runtime',await readFile(new URL('../dist/dev-runtime.js',import.meta.url),'utf8')],['/dev-values.js',await readFile(new URL('../dist/dev-values.js',import.meta.url),'utf8')],['/suite',await readFile(new URL('./dev-conformance-programs.mjs',import.meta.url),'utf8')]]);
        server=createServer((req,res)=>{const text=content.get(req.url);res.setHeader('Content-Type',text?'text/javascript':'text/html');res.end(text??'<title>Conformance</title>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
        runtimeImport=`http://127.0.0.1:${server.address().port}/runtime`;
      }
      const compiled=programs.map(p=>{const transform=cache.transform({root,id:path.join(root,'src',`${p.seed}.js`),code:p.code,options,environment,generation:'conformance',runtimeImport});return {...p,instrumented:transform.code,diagnostics:transform.diagnostics};});
      if(environment==='node'){
        let id=0;const load=async code=>{const file=path.join(root,'.replaylock',`module-${id++}.mjs`);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,code);return import(pathToFileURL(file).href);};
        result.realms.node={...await evaluatePrograms(compiled,api,load),faults:await evaluateFaults(api)};
      }else{
        const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(runtimeImport.replace('/runtime','/'));
        result.realms.browser=await page.evaluate(async programs=>{const api=await import('/runtime'),suite=await import('/suite');const load=async code=>{const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));try{return await import(url);}finally{URL.revokeObjectURL(url);}};return {...await suite.evaluatePrograms(programs,api,load),faults:await suite.evaluateFaults(api)};},compiled);
        await browser.close();browser=undefined;await new Promise(r=>server.close(r));server=undefined;
      }
    }
    return result;
  }catch(error){
    // Save the exact generated source for seed reruns; never record application data.
    const match=/seed=(\d+)/.exec(error.message);
    if(match){const directory=path.resolve('.replaylock/conformance-failures');await mkdir(directory,{recursive:true});const program=programs.find(p=>p.seed===Number(match[1]));await writeFile(path.join(directory,`seed-${match[1]}.json`),JSON.stringify({program,error:error.message},null,2));}
    throw error;
  }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const result=await runConformance({seed:option('--seed')===undefined?undefined:Number(option('--seed')),count:args.includes('--extended')?1000:32,realm:option('--realm')??'both'});
  console.log(JSON.stringify(result));console.log('DEV CONFORMANCE PASSED');
}
