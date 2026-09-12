import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { analyzeDevProject, createDevProjectCache, transformDevSource } from '../../dist/dev-transform.js';
import { resolveDevOptions } from '../../dist/dev-options.js';
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
