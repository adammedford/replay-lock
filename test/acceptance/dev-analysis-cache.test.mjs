import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, rename, rm, stat, utimes, symlink } from 'node:fs/promises';
import { analyzeDevProject, createDevProjectCache, transformDevSource } from '../../dist/dev-transform.js';
import { resolveDevOptions } from '../../dist/dev-options.js';
import { createDevAnalysisClient } from '../../dist/dev-analysis-client.js';
import { createDevInputTracker } from '../../dist/dev-project-cache.js';
import { fixture, put } from '../helpers/dev-fixture.mjs';
const names=a=>a.targets.map(t=>`${t.locator.module}#${t.locator.namePath.join('.')}`);
test('authored module admission rechecks edits and does not admit nonexistent generated modules',async t=>{
  const root=await fixture(t,{'src/a.js':'export function a(){console.log("excluded");}'});
  const cache=createDevProjectCache(root,resolveDevOptions());
  assert.equal(cache.hasAuthoredTargets(path.join(root,'src/a.js'),'node'),false);
  assert.equal(cache.hasAuthoredTargets(path.join(root,'src/generated.js'),'node'),false);
  await put(root,'src/a.js','export function a(n){return n+1;}');
  assert.equal(cache.hasAuthoredTargets(path.join(root,'src/a.js'),'node'),true);
  await put(root,'src/a.js','export function a(){console.log("excluded");}');
  assert.equal(cache.hasAuthoredTargets(path.join(root,'src/a.js'),'node'),false);
});
test('shared plans stay immutable and match fresh transforms, overlays and realm/options changes',async t=>{
  const root=await fixture(t,{'src/a.js':'export function a(n) { return n + Math.random(); }'}),options=resolveDevOptions(),cache=createDevProjectCache(root,options);
  const first=cache.analyze('node');assert.equal(cache.analyze('node'),first);assert.ok(Object.isFrozen(first.targets));assert.throws(()=>first.targets.push({}));assert.notEqual(cache.analyze('browser'),first);
  const input={root,id:path.join(root,'src/a.js'),code:await readFile(path.join(root,'src/a.js'),'utf8'),environment:'node',generation:'1',options};
  assert.deepEqual(cache.transform(input),transformDevSource(input));
  const overlay={...input,code:'// offsets change\n'+input.code};assert.deepEqual(cache.transform(overlay),transformDevSource(overlay));assert.equal(cache.analyze('node'),first);
  const disabled={...input,options:resolveDevOptions({effects:{randomness:false}})};assert.deepEqual(cache.transform(disabled),transformDevSource(disabled));assert.equal(cache.transform(disabled).targets.length,0);
  cache.invalidate();assert.notEqual(cache.analyze('node'),first);
});
test('helper edits with restored mtime, additions, removals and missing probes invalidate cached qualification',async t=>{
  const root=await fixture(t,{'src/main.js':"import {helper} from './helper.js'; export function main(n){return helper(n);}"}),options=resolveDevOptions(),cache=createDevProjectCache(root,options);
  const check=()=>{const value=cache.analyze('node');assert.deepEqual(value,analyzeDevProject(root,options,'node'));return value;};
  assert.ok(!names(check()).includes('src/main.js#main'));
  await put(root,'src/helper.js','export function helper(n){return n+1;}');assert.ok(names(check()).includes('src/main.js#main'));
  const before=await stat(path.join(root,'src/helper.js'));await put(root,'src/helper.js','export function helper(n){console.log(n);return n;}');await utimes(path.join(root,'src/helper.js'),before.atime,before.mtime);assert.ok(!names(check()).includes('src/main.js#main'));
  await rename(path.join(root,'src/helper.js'),path.join(root,'src/renamed.js'));assert.ok(!names(check()).includes('src/main.js#main'));assert.ok(check().diagnostics.some(d=>d.causes?.length));
  await rm(path.join(root,'src/renamed.js'));check();
});
test('package exports, dependency contents, aliases and configuration are fingerprinted again',async t=>{
  const root=await fixture(t,{'src/a.js':"import {h} from 'tiny'; export function a(n){return h(n);}",'node_modules/tiny/package.json':'{"type":"module","exports":"./safe.js"}','node_modules/tiny/safe.js':'export function h(n){return n+1;}','node_modules/tiny/unsafe.js':'export function h(n){console.log(n);return n;}'}),options=resolveDevOptions(),cache=createDevProjectCache(root,options);
  const first=cache.analyze('node');assert.ok(names(first).includes('src/a.js#a'));
  await put(root,'node_modules/tiny/package.json','{"type":"module","exports":"./unsafe.js"}');const unsafe=cache.analyze('node');assert.ok(!names(unsafe).includes('src/a.js#a'));assert.deepEqual(unsafe,analyzeDevProject(root,options,'node'));
  await put(root,'node_modules/tiny/unsafe.js','export function h(n){return n+2;}');assert.ok(names(cache.analyze('node')).includes('src/a.js#a'));
  options.resolveAliases=[{find:'tiny',replacement:path.join(root,'missing.js')}];assert.ok(!names(cache.analyze('node')).includes('src/a.js#a'));
  await put(root,'missing.js','export function h(n){return n+3;}');assert.ok(names(cache.analyze('node')).includes('src/a.js#a'));
  const previous=cache.analyze('node');await put(root,'replaylock.config.mjs','export default {capture:{mode:"annotated"}};');assert.notEqual(cache.analyze('node'),previous);
});


test('authored transformation keeps admission and overlays in the same fresh realm snapshot', async t => {
  const root=await fixture(t,{'src/a.js':'export function a(n){return n+Math.random();}'}), options=resolveDevOptions(), cache=createDevProjectCache(root,options);
  const input={root,id:path.join(root,'src/a.js'),code:'export function a(n){return n+Math.random();}',environment:'browser',generation:'1',options};
  assert.deepEqual(cache.transformAuthored(input),transformDevSource(input));
  const overlay={...input,code:'// shifted source\n'+input.code};
  assert.deepEqual(cache.transformAuthored(overlay),transformDevSource(overlay));
  await put(root,'src/a.js','export function a(n){console.log(n);return n;}');
  assert.equal(cache.transformAuthored(input),null,'an earlier safe overlay must not bypass current authored exclusion');
  assert.equal(cache.transformAuthored({...input,id:path.join(root,'missing.js')}),null);
});


test('selected callers retain transitive dependency effects and unconditional module initialization checks', async t => {
  const root=await fixture(t,{
    'src/main.js':"import {helper} from 'tiny'; export function main(n){return helper(n);}",
    'node_modules/tiny/package.json':'{"type":"module","exports":"./index.js"}',
    'node_modules/tiny/index.js':'export function helper(n){return second(n);} function second(n){console.log(n);return n;} export function dormant(){return Date.now();}',
  }), options=resolveDevOptions(), cache=createDevProjectCache(root,options);
  for(const realm of ['node','browser']) {
    const unsafe=cache.analyze(realm);
    assert.ok(!names(unsafe).includes('src/main.js#main'));
    assert.ok(unsafe.diagnostics.some(d=>d.code==='LOGGING'));
  }
  await put(root,'node_modules/tiny/index.js','export function helper(n){return second(n);} function second(n){return n+1;} export function dormant(){return Date.now();}');
  for(const realm of ['node','browser']) assert.ok(names(cache.analyze(realm)).includes('src/main.js#main'));
  await put(root,'node_modules/tiny/index.js','const initial=Date.now(); export function helper(n){return n+1;}');
  for(const realm of ['node','browser']) {
    const unsafe=cache.analyze(realm);
    assert.ok(!names(unsafe).includes('src/main.js#main'));
    assert.ok(unsafe.diagnostics.some(d=>d.code==='EFFECTFUL_INITIALIZATION'));
  }
});


test('cached dependency edits match retained pre-optimization analysis, transforms and maps', async t => {
  const baseline=JSON.parse(await readFile(new URL('../fixtures/responsiveness/project-baseline.json',import.meta.url),'utf8'));
  const root=await fixture(t,baseline.files),options=resolveDevOptions(),cache=createDevProjectCache(root,options);
  const normalize=value=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='string'?item.split(root).join('$root').split(root.split(path.sep).join('/')).join('$root'):item));
  for(const stage of baseline.stages) {
    await put(root,'node_modules/tiny/index.js',stage.dependency);
    for(const environment of ['node','browser']) {
      const input={root,id:path.join(root,'src/main.js'),code:baseline.files['src/main.js'],environment,generation:'1',options};
      assert.deepEqual(normalize(cache.analyze(environment)),stage.realms[environment].analysis);
      assert.deepEqual(normalize(cache.transform(input)),stage.realms[environment].transform);
      assert.deepEqual(normalize(cache.transform({...input,code:'// shifted\n'+input.code})),stage.realms[environment].overlay);
    }
  }
});


test('missing probe validation detects additions, directory replacement and dangling link targets without watchers', async t => {
  const root=await fixture(t,{'src/keep.js':'export const value=1;'});
  const probe=path.join(root,'src/missing.js'),tracker=createDevInputTracker();
  assert.equal(tracker.isFile(probe),false);
  assert.equal(tracker.isCurrent(),true);
  const before=await stat(path.dirname(probe));
  await put(root,'src/missing.js','export const value=2;');
  await utimes(path.dirname(probe),before.atime,before.mtime);
  assert.equal(tracker.isCurrent(),false,'restored parent mtime must not hide a new file');
  const replaced=createDevInputTracker();replaced.isFile(path.join(root,'src/another.js'));
  await rename(path.join(root,'src'),path.join(root,'old'));
  await put(root,'src/another.js','export const value=1;');
  assert.equal(replaced.isCurrent(),false,'replacement directories invalidate missing probes');
  const nested=createDevInputTracker();nested.isFile(path.join(root,'absent/deep/file.js'));
  await put(root,'absent/deep/file.js','export const value=3;');
  assert.equal(nested.isCurrent(),false,'missing parents retain direct validation');
  if(process.platform==='win32')return;
  const target=path.join(root,'elsewhere/target.js');
  await put(root,'elsewhere/keep.js','');
  await symlink(target,path.join(root,'src/link.js'));
  const dangling=createDevInputTracker();assert.equal(dangling.isFile(path.join(root,'src/link.js')),false);
  await put(root,'elsewhere/target.js','export const value=4;');
  assert.equal(dangling.isCurrent(),false,'a target can appear without changing the link directory');
});


test('realm workers preserve fresh analysis, source maps, configuration and shutdown', async t => {
  const root=await fixture(t,{'src/a.js':'export function a(n){return n+Math.random();}'}),options=resolveDevOptions();
  const client=createDevAnalysisClient(root,options);
  t.after(()=>client.close());
  const realms=['node','browser'];
  const analyses=await Promise.all(realms.map(realm=>client.analyze(realm)));
  for(const [index,environment] of realms.entries()) {
    assert.deepEqual(analyses[index],analyzeDevProject(root,options,environment));
    const input={root,id:path.join(root,'src/a.js'),code:await readFile(path.join(root,'src/a.js'),'utf8'),environment,generation:'1',options};
    assert.deepEqual(await client.transformAuthored(input),structuredClone(transformDevSource(input)));
  }
  await put(root,'src/a.js','export function a(n){console.log(n);return n;}');
  assert.equal((await client.analyze('node')).targets.length,0,'freshness must not rely on a watcher message');
  await put(root,'src/a.js','export function a(n){return n+Math.random();}');
  client.configure(resolveDevOptions({effects:{randomness:false}}));
  for(const result of await Promise.all(realms.map(realm=>client.analyze(realm))))assert.equal(result.targets.length,0);
  client.configure(options);
  for(const result of await Promise.all(realms.map(realm=>client.analyze(realm))))assert.equal(result.targets.length,1);
  const pending=client.analyze('node');
  const settled=Promise.allSettled([pending]);
  await client.close();
  await settled;
  await assert.rejects(client.analyze('node'),/session is closed/);
});
