import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
const request=JSON.parse(await readFile(process.argv[2],'utf8'));
const moduleAt=file=>import(pathToFileURL(path.join(request.package,'dist',file)).href);
const transform=await moduleAt('dev-transform.js'),{resolveDevOptions}=await moduleAt('dev-options.js');
const root=await mkdtemp(path.join(tmpdir(),'replaylock-benchmark-'));const options=resolveDevOptions();
let result;
try{
  await writeFile(path.join(root,'package.json'),'{"name":"benchmark","type":"module","private":true}');await writeFile(path.join(root,'package-lock.json'),'{"lockfileVersion":3}');await mkdir(path.join(root,'src'));
  if(request.kind==='load'){
    const modules=Array.from({length:request.size},(_,n)=>({id:path.join(root,'src',`m${n}.js`),code:`export function f${n}(n){return n+Math.random();}`}));
    for(const module of modules)await writeFile(module.id,module.code);
    const started=performance.now(),cache=transform.createDevProjectCache?.(root,options);
    const analyze=()=>cache?cache.analyze('node'):transform.analyzeDevProject(root,options,'node');
    const rewrite=module=>{const input={...module,root,environment:'node',generation:'benchmark',options,runtimeImport:pathToFileURL(path.join(request.package,'dist/dev-runtime.js')).href};return cache?cache.transform(input):transform.transformDevSource(input);};
    const analysis=await analyze();if(analysis.targets.length!==request.size)throw Error('fixture targets missing');
    for(const module of modules)if(rewrite(module).targets.length!==1)throw Error('fixture transform missing');
    const coldLoadMs=performance.now()-started;
    const changed={...modules[0],code:modules[0].code.replace('n+','n + 1 + ')};
    const edit=performance.now();await writeFile(changed.id,changed.code);cache?.invalidate();const output=rewrite(changed);const editToReadyMs=performance.now()-edit;
    await mkdir(path.join(root,'.replaylock'));const executable=path.join(root,'.replaylock','measure.mjs');await writeFile(executable,output.code);
    const callable=(await import(pathToFileURL(executable).href)).f0;
    const api=await moduleAt('dev-runtime.js');const iterations=10000;
    let sum=0;api.configureDevRuntime(undefined);const originalStart=performance.now();for(let n=0;n<iterations;n++)sum+=callable(n);const disabledMs=performance.now()-originalStart;
    let observations=0;api.configureDevRuntime({onObservation(){observations++;},onBlock(block){throw Error(block.code);}});const captureStart=performance.now();for(let n=0;n<iterations;n++)sum+=callable(n);const captureMs=performance.now()-captureStart;api.configureDevRuntime(undefined);
    if(observations!==iterations||!Number.isFinite(sum))throw Error('invocations were not observed');
    result={kind:'load',size:request.size,coldLoadMs,editToReadyMs,invocation:{iterations,disabledMs,captureMs,addedMicroseconds:(captureMs-disabledMs)*1000/iterations},peakKiB:process.resourceUsage().maxRSS};
  }else{
    const source='export function calculate(n){return n+Math.random();}';await writeFile(path.join(root,'src/main.js'),source);
    const {createDevCandidate,toDevCase}=await moduleAt('dev-artifacts.js'),{encodeDevValue}=await moduleAt('dev-values.js'),{runtimeProfile}=await moduleAt('dev-runtime.js');
    const analysis=await transform.analyzeDevProject(root,options,'node');const digest=`sha256:${'a'.repeat(64)}`;
    const cases=Array.from({length:request.size},(_,n)=>toDevCase(createDevCandidate({locator:{module:'src/main.js',kind:'export',namePath:['calculate']},environment:'node',generation:'bench',sourceGraphDigest:analysis.sourceGraphDigest,arguments:encodeDevValue([n]),trace:[{kind:'call',id:0,operation:'Math.random',arguments:encodeDevValue([])},{kind:'return',id:0,value:encodeDevValue(0.25)}],completion:{kind:'return',value:encodeDevValue(n+0.25)}},digest,runtimeProfile('node'))));
    await mkdir(path.join(root,'.replaylock'));const memory=path.join(root,'.replaylock','memory');await mkdir(memory);
    const input=path.join(root,'.replaylock','input.json');await writeFile(input,JSON.stringify({root,cases,options}));
    const runner=path.join(root,'.replaylock','run.mjs');await writeFile(runner,`import {readFile} from 'node:fs/promises';import {verifyDevCases} from ${JSON.stringify(pathToFileURL(path.join(request.package,'dist/dev-verify.js')).href)};const p=JSON.parse(await readFile(${JSON.stringify(input)},'utf8'));process.exitCode=await verifyDevCases(p.root,p.cases,p.options);`);
    const started=performance.now();const run=spawnSync(process.execPath,[runner],{cwd:root,encoding:'utf8',timeout:request.size*90000+30000,maxBuffer:8*1024*1024,env:{...process.env,NODE_OPTIONS:`--import=${pathToFileURL(path.resolve('scripts/bench-dev-replay.mjs')).href}`,REPLAYLOCK_BENCH_MEMORY_DIR:memory}});const replayMs=performance.now()-started;
    if(run.status!==0)throw Error(`replay benchmark failed: ${run.stderr}${run.stdout}`);
    const processes=await Promise.all((await readdir(memory)).map(async file=>JSON.parse(await readFile(path.join(memory,file),'utf8'))));
    if(processes.length<request.size+1)throw Error('missing replay descendant memory evidence');
    result={kind:'replay',size:request.size,replayMs,processes:processes.length,peakKiB:Math.max(...processes.map(p=>p.peakKiB))};
  }
  await writeFile(request.output,JSON.stringify(result));
}finally{await rm(root,{recursive:true,force:true});}
