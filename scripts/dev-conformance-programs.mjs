/** Portable, deterministic program generation and behavioral oracle, shared by Node and Chromium. */
export const SETTLEMENTS = ['normal','reverse','interleaved'];
export function generatedProgram(seed) {
  let state=seed>>>0;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  const constant=next()%17+1, variant=seed%8;
  const programs=[
    `function child(n){return n * ${constant} + Math.random();} export function main(n){return {items:[child(n),Date.now()],input:n};}`,
    `function combine(a,b,c){return [a,b,c];} export function main(n){return combine(Math.random(),Date.now(),Math.random()+n);}`,
    `export function main(n){return n % 3 ? Math.random()+${constant} : Date.now()-n;}`,
    `async function read(url){const response=await fetch(url);return await response.text();} export async function main(n){const [x,y]=await Promise.all([read('https://fixture.test/a'),read('https://fixture.test/b')]);return [x,y,n+${constant}];}`,
    `export async function main(n){try{const response=await fetch('https://fixture.test/reject');return await response.text();}catch(error){return {kind:'rejected',input:n};}}`,
    `export function main(n){function nested(x){return x+Math.random();}return nested(n)+nested(${constant});}`,
    `export function main(n){const x=Math.random();if(n%3)throw new Error('generated failure');return x+${constant};}`,
    `export function main(input){input[0]+=Math.random();return input[0]+${constant};}`,
  ];
  return {seed,variant,code:programs[variant],args:variant===7?[[seed]]:[seed],eligible:variant!==7};
}
function assert(condition, message) {if(!condition)throw new Error(message);}
const same=(a,b,label)=>assert(JSON.stringify(a)===JSON.stringify(b),`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const completion=async fn=>{try{return {kind:'return',value:await fn()};}catch(error){return {kind:'throw',value:{name:error.name,message:error.message}};}};
function controlled(seed,schedule,offline=false){
  const saved={random:Math.random,now:Date.now,fetch:globalThis.fetch,text:Response.prototype.text};
  let randomState=seed>>>0, fetchIndex=0;
  const log=[],pending=[];
  let scheduled=false;
  const forbidden=()=>{throw new Error('NATIVE_EFFECT_DURING_REPLAY');};
  Math.random=offline?forbidden:()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;log.push('random');return randomState/4294967296;};
  Date.now=offline?forbidden:()=>{log.push('time');return 1700000000000+seed;};
  globalThis.fetch=offline?forbidden:url=>{
    const index=fetchIndex++;log.push(`fetch:${index}:${url}`);
    const promise=new Promise((resolve,reject)=>pending.push(()=>{log.push(`settled:${index}`);String(url).endsWith('/reject')?reject(new TypeError('synthetic rejection')):resolve(new Response(`body-${seed}-${index}`));}));
    if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;const jobs=pending.splice(0);if(schedule==='reverse')jobs.reverse();if(schedule==='interleaved'){jobs.filter((_,i)=>i%2).forEach(run=>run());queueMicrotask(()=>jobs.filter((_,i)=>!(i%2)).forEach(run=>run()));}else jobs.forEach(run=>run());});}
    return promise;
  };
  Response.prototype.text=offline?forbidden:function(){log.push('body');return saved.text.call(this);};
  return {log,restore(){Math.random=saved.random;Date.now=saved.now;globalThis.fetch=saved.fetch;Response.prototype.text=saved.text;}};
}
export async function evaluatePrograms(programs,api,load){
  let executed=0,replayed=0,excluded=0,throws=0;
  for(const program of programs)for(const schedule of SETTLEMENTS){
    const original=await load(program.code),instrumented=await load(program.instrumented);
    const run=async(module,record)=>{
      const observations=[],blocks=[],args=structuredClone(program.args),native=controlled(program.seed,schedule);
      api.configureDevRuntime(record?{onObservation:o=>observations.push(o),onBlock:b=>blocks.push(b)}:undefined);
      try{return {completion:await completion(()=>module.main(...args)),args,log:native.log,observations,blocks};}
      finally{native.restore();api.configureDevRuntime(undefined);}
    };
    try{
      const baseline=await run(original,false),captured=await run(instrumented,true);executed++;if(baseline.completion.kind==='throw')throws++;
      same(captured.completion,baseline.completion,'completion');same(captured.args,baseline.args,'mutation');same(captured.log,baseline.log,'evaluation order / native effect count');
      if(!program.eligible){assert(program.diagnostics.length>0,'unsafe program lacked diagnostic');assert(captured.observations.length===0,'excluded mutation was recorded');excluded++;continue;}
      same(captured.blocks,[],'unexpected capture blocks');
      const observation=captured.observations.find(o=>o.locator.namePath.join('.')==='main');assert(observation,'missing main observation');
      const native=controlled(program.seed,schedule,true);
      try{const actual=await api.replayDevTrace(observation.trace,()=>completion(()=>instrumented.main(...structuredClone(program.args))));same(actual,baseline.completion,'offline completion');assert(native.log.length===0,'native reads during replay');replayed++;}
      finally{native.restore();}
    }catch(error){throw new Error(`CONFORMANCE_FAILURE seed=${program.seed} schedule=${schedule} variant=${program.variant}: ${error.message}`,{cause:error});}
  }
  return {executed,replayed,excluded,throws};
}
export async function evaluateFaults(api){
  const metadata={locator:{module:'faults.js',kind:'export',namePath:['main']},environment:typeof process==='undefined'?'browser':'node',generation:'faults',sourceGraphDigest:'a'.repeat(64)};
  let native=0;const blocks=[],observations=[];
  const run=()=>api.observeDevCall(metadata,[],frame=>api.devEffect(frame,'Math.random',[],()=>++native));
  try{
    api.configureDevRuntime({onActivity(){throw new Error('observer');},onObservation(){throw new Error('sink');},onBlock:b=>blocks.push(b.code)});
    assert(run()===1&&native===1,'observer changed completion');assert(blocks.includes('STORAGE_FAILURE'),'sink failure not diagnosed');
    blocks.length=0;api.configureDevRuntime({onObservation:o=>observations.push(o),onBlock:b=>blocks.push(b.code)});
    let finish;const pending=new Promise(r=>finish=r);const calls=[];
    for(let i=0;i<1001;i++)calls.push(api.observeDevCall(metadata,[],()=>pending,true));
    assert(blocks.includes('PENDING_LIMIT'),'capacity was not bounded');finish(4);same(await Promise.all(calls),Array(1001).fill(4),'capacity changed application promises');assert(observations.length===1000,'capacity did not bound observations');
    api.configureDevRuntime(undefined);blocks.length=0;observations.length=0;
    api.configureDevRuntime({onObservation:o=>observations.push(o),onBlock:b=>blocks.push(b.code)});
    let settle;const detached=new Promise(r=>settle=r);
    assert(api.observeDevCall(metadata,[],frame=>{api.devEffect(frame,'fs.readFile',[],()=>detached);return 9;})===9,'detached completion changed');
    assert(blocks.includes('INCOMPLETE_OBSERVATION'),'detached work was captured');settle('done');await detached;await Promise.resolve();assert(observations.length===0,'incomplete observation escaped');
    return {observerFailures:true,capacity:1001,detachedRejected:true};
  }finally{api.configureDevRuntime(undefined);}
}
