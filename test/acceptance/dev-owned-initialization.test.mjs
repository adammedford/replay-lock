import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { rename, symlink } from 'node:fs/promises';
import { fixture, command, put } from '../helpers/dev-fixture.mjs';
import { analyzeDevProject, createDevProjectCache, transformDevSource } from '../../dist/dev-transform.js';
import { resolveDevOptions } from '../../dist/dev-options.js';

const positive = 'const table=[0,0,0];for(let i=0;i<3;i++){table[i]=i*2;}export function answer(){return table[2];}';

async function scan(t, files) {
  const root = await fixture(t, files);
  const result = await command(root, ['scan', '--dev', '--json']);
  assert.equal(result.status, 0, result.output);
  return JSON.parse(result.output).environments;
}

test('P1: dense closed initialization admits its actual completed table read in both realms', async t => {
  for (const realm of await scan(t, { 'src/answer.js': positive })) {
    assert.ok(realm.targets.some(target => target.locator.namePath.join('.') === 'answer'), `${realm.environment}: computed table read rejected`);
    assert.ok(!realm.diagnostics.some(diagnostic => ['EFFECTFUL_INITIALIZATION', 'AMBIENT_STATE'].includes(diagnostic.code)));
  }
});

async function matrix(t, cases) {
  const realms = await scan(t, Object.fromEntries(cases.map(([name, source]) => [`src/${name}.js`, source])));
  for (const realm of realms) for (const [name, , eligible, code] of cases) {
    const module = `src/${name}.js`;
    assert.equal(realm.targets.some(target => target.locator.module === module && target.locator.namePath.join('.') === 'answer'), eligible, `${realm.environment}: ${name}`);
    if (code) assert.ok(realm.diagnostics.some(diagnostic => diagnostic.locator.module === module && diagnostic.code === code), `${realm.environment}: ${name} missing ${code}`);
  }
}

test('P1 opposites: borrowed receivers and missing own slots cannot inherit closed construction', async t => {
  await matrix(t, [
    ['borrowed', positive.replace('[0,0,0]', 'globalThis.borrowed'), false, 'EFFECTFUL_INITIALIZATION'],
    ['sparse', positive.replace('[0,0,0]', '[0,,0]'), false, 'EFFECTFUL_INITIALIZATION'],
    ['out-of-range', positive.replace('table[i]=', 'table[i+1]='), false, 'EFFECTFUL_INITIALIZATION'],
  ]);
});

test('P2/P3: own length, exact prior constants, finite arithmetic and completed existing-slot reads', async t => {
  await matrix(t, [
    ['length', positive.replace('i<3', 'i<table.length'), true],
    ['prior-fact', 'const factor=2;const key=2;const table=[1,1,1];for(let i=0;i<table.length;++i){table[i]=(-(-factor)*i)+table[i];}export function answer(){return table[key];}', true],
    ['arithmetic', 'const table=[4,4,4];for(let i=0;i<3;i++){table[i]=(table[i]/2)+(i*3%2)-1;}export function answer(){return table[(1+1)];}', true],
    ['second-computed', positive.replace('i*2', 'i*3'), true],
    ['unknown-final-key', positive.replace('answer()', 'answer(key)').replace('table[2]', 'table[key]'), false, 'AMBIENT_STATE'],
    ['object-final-key', positive.replace('table[2]', 'table[{valueOf(){return 2;}}]'), false, 'AMBIENT_STATE'],
    ['past-extent-final-key', positive.replace('table[2]', 'table[3]'), false, 'AMBIENT_STATE'],
    ['mutable-prior', 'let factor=2;'+positive.replace('i*2', 'i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['later-prior', positive.replace('i*2', 'i*factor')+'const factor=2;', false, 'EFFECTFUL_INITIALIZATION'],
    ['forward-fact', 'const factor=later;const later=2;'+positive.replace('i*2', 'i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['nonfinite', positive.replace('i*2', '1/0'), false, 'EFFECTFUL_INITIALIZATION'],
    ['nonfinite-intermediate', positive.replace('i*2', '(1/0)*0'), false, 'EFFECTFUL_INITIALIZATION'],
  ]);
});

test('H1-H7: ownership, own-slot, primitive and closed-control-flow opposites remain rejected', async t => {
  const changedBody = body => positive.replace('table[i]=i*2;', body);
  const appended = statement => positive+statement;
  await matrix(t, [
    ['alias', positive.replace('for(let', 'const alias=table;for(let'), false, 'EFFECTFUL_INITIALIZATION'],
    ['alias-reassignment', appended('let alias=table;alias=[];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['counter-shadow', changedBody('let i={valueOf(){return 0;}};table[i]=2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['receiver-shadow', changedBody('const table=globalThis.borrowed;table[i]=2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['assignment-receiver', changedBody('table=globalThis.borrowed;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['length-write', changedBody('table.length=4;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['delete-slot', changedBody('delete table[i];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['descriptor', changedBody('Object.defineProperty(table,i,{get(){return 2;}});'), false, 'EFFECTFUL_INITIALIZATION'],
    ['prototype-receiver', changedBody('Object.setPrototypeOf(table,{});'), false, 'EFFECTFUL_INITIALIZATION'],
    ['compound-write', changedBody('table[i]+=2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['destructured-later-write', appended('[table[2]]=[5];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['fraction-final-key', positive.replace('table[2]', 'table[1.5]'), false, 'AMBIENT_STATE'],
    ['negative-final-key', positive.replace('table[2]', 'table[-1]'), false, 'AMBIENT_STATE'],
    ['unknown-operand', changedBody('table[i]=globalThis.factor;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['object-operand', changedBody('table[i]=({valueOf(){return 2;}})*i;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['getter-operand', changedBody('table[i]=({get x(){return 2;}}).x*i;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['proxy-operand', changedBody('table[i]=new Proxy({x:2},{}).x*i;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['nested-borrowed', positive.replace('[0,0,0]', '[globalThis.borrowed,0,0]'), false, 'EFFECTFUL_INITIALIZATION'],
    ['append', changedBody('table.push(i);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['method', changedBody('table.fill(i);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['iterator', changedBody('[table[i]]=[i];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['spread', changedBody('table[i]=[...table][i];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['for-of', changedBody('for(const value of table){table[i]=value;}'), false, 'EFFECTFUL_INITIALIZATION'],
    ['ambient-BigInt', changedBody('table[i]=BigInt(i);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['ambient-Number', changedBody('table[i]=Number(i);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['typed-constructor', changedBody('table[i]=new Uint32Array([i])[0];'), false, 'EFFECTFUL_INITIALIZATION'],
    ['export-container', appended('export {table};'), false, 'EFFECTFUL_INITIALIZATION'],
    ['return-container', positive.replace('return table[2]', 'return table'), false, 'EFFECTFUL_INITIALIZATION'],
    ['callback-container', appended('setTimeout(()=>table,1);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['unknown-container-use', appended('unknown(table);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['shorthand-container-use', appended('const escaped={table};'), false, 'EFFECTFUL_INITIALIZATION'],
    ['later-write', appended('table[0]=99;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['member-traversal', positive.replace('table[2]', 'table[2].toString()'), false, 'AMBIENT_STATE'],
    ['read-as-callee', positive.replace('table[2]', 'table[2]()'), false, 'AMBIENT_STATE'],
    ['short-bound', positive.replace('i<3', 'i<2'), false, 'EFFECTFUL_INITIALIZATION'],
    ['long-bound', positive.replace('i<3', 'i<4'), false, 'EFFECTFUL_INITIALIZATION'],
    ['unknown-bound', positive.replace('i<3', 'i<globalThis.extent'), false, 'EFFECTFUL_INITIALIZATION'],
    ['prior-const-bound', 'const extent=3;'+positive.replace('i<3', 'i<extent'), false, 'EFFECTFUL_INITIALIZATION'],
    ['wrong-start', positive.replace('i=0', 'i=1'), false, 'EFFECTFUL_INITIALIZATION'],
    ['wrong-increment', positive.replace('i++', 'i+=1'), false, 'EFFECTFUL_INITIALIZATION'],
    ['wrong-comparison', positive.replace('i<3', 'i<=2'), false, 'EFFECTFUL_INITIALIZATION'],
    ['counter-update', changedBody('i++;table[i]=2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['nested-loop', changedBody('for(let j=0;j<1;j++){table[i]=j;}'), false, 'EFFECTFUL_INITIALIZATION'],
    ['branch', changedBody('if(i<2)table[i]=2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['try-body', changedBody('try{table[i]=2;}catch{}'), false, 'EFFECTFUL_INITIALIZATION'],
    ['await-body', changedBody('table[i]=await 2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['top-level-await', appended('await 2;'), false, 'EFFECTFUL_INITIALIZATION'],
    ['unbounded', positive.replace('i<3', 'true'), false, 'EFFECTFUL_INITIALIZATION'],
    ['empty-append', positive.replace('[0,0,0]', '[]').replace('table[i]=i*2;', 'table.push(i);'), false, 'EFFECTFUL_INITIALIZATION'],
    ['nonadjacent', positive.replace('for(let', ';for(let'), false, 'EFFECTFUL_INITIALIZATION'],
    ['reassigned-fact', 'const factor=2;try{factor=3;}catch{}'+positive.replace('i*2','i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['destructured-fact', 'const factor=2;try{[factor]=[3];}catch{}'+positive.replace('i*2','i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['property-destructured-fact', 'const factor=2;try{({x:factor}={x:3});}catch{}'+positive.replace('i*2','i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['for-of-fact', 'const factor=2;try{for(factor of [3]){}}catch{}'+positive.replace('i*2','i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
    ['for-in-fact', 'const factor=2;try{for(factor in {x:3}){}}catch{}'+positive.replace('i*2','i*factor'), false, 'EFFECTFUL_INITIALIZATION'],
  ]);
});

test('H8: construction cannot erase independent effects, including caught effects', async t => {
  await matrix(t, [
    ['logging', positive+'console.log("synthetic");', false, 'EFFECTFUL_INITIALIZATION'],
    ['filesystem', 'import {readFileSync} from "node:fs";'+positive+'readFileSync("synthetic");', false, 'EFFECTFUL_INITIALIZATION'],
    ['network', positive+'fetch("https://example.invalid/");', false, 'EFFECTFUL_INITIALIZATION'],
    ['timer', positive+'setTimeout(()=>{},1);', false, 'EFFECTFUL_INITIALIZATION'],
    ['listener', positive+'globalThis.addEventListener("synthetic",()=>{});', false, 'EFFECTFUL_INITIALIZATION'],
    ['dom', positive+'document.body.textContent="synthetic";', false, 'EFFECTFUL_INITIALIZATION'],
    ['global-write', positive+'globalThis.synthetic=1;', false, 'EFFECTFUL_INITIALIZATION'],
    ['prototype-write', positive+'Array.prototype.synthetic=1;', false, 'EFFECTFUL_INITIALIZATION'],
    ['caught-logging', positive+'try{console.log("synthetic");}catch{}', false, 'EFFECTFUL_INITIALIZATION'],
    ['in-loop-logging', positive.replace('table[i]=i*2;', 'table[i]=i*2;console.log("synthetic");'), false, 'EFFECTFUL_INITIALIZATION'],
  ]);
});

test('H9/H6: imports, cycles, invalid policies and unsupported callable shapes are independent', async t => {
  const realms = await scan(t, {
    'src/effect.js': 'console.log("synthetic");export function helper(){return 1;}',
    'src/middle.js': 'import {helper} from "./effect.js";export function middle(){return helper();}',
    'src/bare.js': 'import "./effect.js";'+positive,
    'src/transitive.js': 'import {middle} from "./middle.js";'+positive.replace('table[2]', 'table[2]+middle()'),
    'src/imported.js': 'import {table} from "./table.js";'+positive.replace('const table=[0,0,0];', ''),
    'src/table.js': 'export const table=[0,0,0];',
    'src/helper.js': 'export function helper(i){return i*2;}',
    'src/helper-call.js': 'import {helper} from "./helper.js";'+positive.replace('i*2', 'helper(i)'),
    'src/cycle.js': 'import "./cycle-back.js";'+positive,
    'src/cycle-back.js': 'import "./cycle.js";',
    'src/policy.js': positive.replace('export function', '\n/** @replaylock capture extra */\nexport function'),
    'src/generator.js': positive.replace('function answer', 'function* answer'),
  });
  for (const realm of realms) {
    for (const name of ['bare','transitive','imported','helper-call','cycle','policy','generator']) assert.ok(!realm.targets.some(target => target.locator.module === `src/${name}.js` && target.locator.namePath.join('.') === 'answer'), `${realm.environment}: ${name}`);
    for (const [name, code] of [['bare','EFFECTFUL_INITIALIZATION'],['transitive','EFFECTFUL_INITIALIZATION'],['imported','EFFECTFUL_INITIALIZATION'],['helper-call','EFFECTFUL_INITIALIZATION'],['cycle','EFFECTFUL_INITIALIZATION'],['policy','INVALID_POLICY'],['generator','UNSUPPORTED_CALLABLE']]) assert.ok(realm.diagnostics.some(diagnostic => diagnostic.locator.module === `src/${name}.js` && diagnostic.code === code), `${realm.environment}: ${name} missing ${code}`);
  }
});

test('H7/C3: exact 256-slot boundary, 257 slots and bounded AST arithmetic/depth', async t => {
  const boundary = `const table=[${Array(256).fill('0').join(',')}];for(let i=0;i<256;i++){table[i]=i*2;}export function answer(){return table[255];}`;
  const started = performance.now();
  await matrix(t, [
    ['boundary', boundary, true],
    ['over-extent', boundary.replace('table=[', 'table=[0,').replace('i<256', 'i<257'), false, 'EFFECTFUL_INITIALIZATION'],
    ['work-cap', boundary.replace('i*2', Array(100).fill('1').join('+')), false, 'EFFECTFUL_INITIALIZATION'],
    ['depth-cap', positive.replace('i*2', '(' .repeat(200)+'i*2'+')'.repeat(200)), false, 'EFFECTFUL_INITIALIZATION'],
    ['source-node-cap', positive+';'.repeat(17000), false, 'EFFECTFUL_INITIALIZATION'],
  ]);
  const elapsed = performance.now()-started;
  t.diagnostic(`Public five-fixture, both-realm bounded scan elapsed ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 15000, `bounded synthetic scan exceeded existing fixture timeout: ${elapsed}ms`);
});

test('H11: exact table source, unsafe HMR overlays, config, lockfile and realm requalify warm admission', async t => {
  const unsafe = positive.replace('table[i]=', 'table[i+1]=');
  const root = await fixture(t, { 'src/answer.js': positive });
  const options = resolveDevOptions(), cache = createDevProjectCache(root, options);
  for (const environment of ['node','browser']) {
    const initial = cache.analyze(environment);
    assert.equal(initial.targets.length, 1);
    assert.deepEqual(initial, analyzeDevProject(root, options, environment));
    const input = { root, id: path.join(root,'src/answer.js'), code: unsafe, environment, generation: 'owned-proof', options };
    assert.deepEqual(cache.transform(input), transformDevSource(input));
    assert.equal(cache.transform(input).targets.length, 0);
    assert.equal(cache.analyze(environment), initial, 'overlay must not replace physical-source proof');
    await put(root,'src/answer.js',unsafe);
    assert.deepEqual(cache.analyze(environment),analyzeDevProject(root,options,environment));
    assert.equal(cache.analyze(environment).targets.length,0);
    await put(root,'src/answer.js',positive);
    const restored=cache.analyze(environment);
    assert.equal(restored.targets.length,1);
    await put(root,'package-lock.json',`{"lockfileVersion":3,"name":"owned-${environment}"}`);
    assert.notEqual(cache.analyze(environment),restored);
    assert.deepEqual(cache.analyze(environment),analyzeDevProject(root,options,environment));
    const lockChanged=cache.analyze(environment);
    await put(root,'replaylock.config.mjs',`export default {synthetic:"${environment}"};`);
    assert.notEqual(cache.analyze(environment),lockChanged);
    assert.deepEqual(cache.analyze(environment),analyzeDevProject(root,options,environment));
    options.capture.mode='annotated';
    assert.equal(cache.analyze(environment).targets.length,0);
    options.capture.mode='automatic';
    assert.equal(cache.analyze(environment).targets.length,1);
  }
});

test('H11: dependency table bytes, package exports, aliases and conditions cannot reuse safe proof', async t => {
  const safe=positive.replace('function answer','function helper');
  const unsafe=safe.replace('table[i]=','table[i+1]=');
  const manifest='{"type":"module","exports":{"safe":"./safe.js","danger":"./unsafe.js","default":"./safe.js"}}';
  const root=await fixture(t,{
    'src/answer.js':'import {helper} from "tiny";export function answer(){return helper();}',
    'node_modules/tiny/package.json':manifest,
    'node_modules/tiny/safe.js':safe,
    'node_modules/tiny/unsafe.js':unsafe,
  });
  const options={...resolveDevOptions(),resolveConditions:{node:['safe'],browser:['safe']}},cache=createDevProjectCache(root,options);
  const check=(realm,eligible)=>{
    const actual=cache.analyze(realm);
    assert.deepEqual(actual,analyzeDevProject(root,options,realm));
    assert.equal(actual.targets.some(target=>target.locator.module==='src/answer.js'),eligible,realm);
    if(!eligible)assert.ok(actual.diagnostics.some(item=>item.locator.module==='src/answer.js'&&item.code==='EFFECTFUL_INITIALIZATION'));
  };
  for(const realm of ['node','browser']){
    await put(root,'node_modules/tiny/package.json',manifest);check(realm,true);
    await put(root,'node_modules/tiny/safe.js',unsafe);check(realm,false);
    await put(root,'node_modules/tiny/safe.js',safe);check(realm,true);
    options.resolveConditions={node:['danger'],browser:['danger']};check(realm,false);
    options.resolveConditions={node:['safe'],browser:['safe']};check(realm,true);
    options.resolveAliases=[{find:'tiny',replacement:path.join(root,'node_modules/tiny/unsafe.js')}];check(realm,false);
    delete options.resolveAliases;check(realm,true);
    await put(root,'node_modules/tiny/package.json','{"type":"module","exports":"./unsafe.js"}');check(realm,false);
    await put(root,'node_modules/tiny/package.json','{"type":"module","exports":"./safe.js"}');check(realm,true);
  }
});

test('H11: removing and restoring a dependency cycle requalifies unchanged authored tables', async t => {
  const source = 'import "./dependency.js";' + positive;
  const cycle = 'import "./answer.js";export const marker=1;';
  const root = await fixture(t, { 'src/answer.js': source, 'src/dependency.js': cycle });
  const options = resolveDevOptions(), cache = createDevProjectCache(root, options);
  for (const environment of ['node', 'browser']) {
    await put(root, 'src/dependency.js', cycle);
    cache.analyze(environment);
    const input = { root, id: path.join(root, 'src/answer.js'), code: source, environment, generation: 'owned-cycle', options };
    assert.equal(cache.transformAuthored(input), null);
    for (const dependency of ['export const marker=1;', cycle, 'export const marker=2;']) {
      await put(root, 'src/dependency.js', dependency);
      const cold = transformDevSource(input);
      const expected = cold.targets.length ? cold : null;
      assert.deepEqual(cache.transformAuthored(input), expected, `${environment}: dependency change must invalidate authored exclusion`);
      assert.deepEqual(cache.analyze(environment), analyzeDevProject(root, options, environment));
    }
  }
});

test('H11: a replaced physical table locator cannot borrow its previous admission', async t => {
  if(process.platform==='win32'){t.skip('symlink privileges unavailable in Windows contract');return;}
  const root=await fixture(t,{
    'src/answer.js':'import {helper} from "./linked.js";export function answer(){return helper();}',
    '.modules/safe.js':positive.replace('function answer','function helper'),
    '.modules/unsafe.js':positive.replace('function answer','function helper').replace('table[i]=','table[i+1]='),
  });
  await symlink(path.join(root,'.modules/safe.js'),path.join(root,'src/linked.js'));
  const options=resolveDevOptions(),cache=createDevProjectCache(root,options);
  for(const realm of ['node','browser'])assert.ok(cache.analyze(realm).targets.some(target=>target.locator.module==='src/answer.js'));
  await rename(path.join(root,'src/linked.js'),path.join(root,'.modules/old-link.js'));
  await symlink(path.join(root,'.modules/unsafe.js'),path.join(root,'src/linked.js'));
  for(const realm of ['node','browser']){
    const actual=cache.analyze(realm);
    assert.deepEqual(actual,analyzeDevProject(root,options,realm));
    assert.ok(!actual.targets.some(target=>target.locator.module==='src/answer.js'));
    assert.ok(actual.diagnostics.some(item=>item.locator.module==='src/answer.js'&&item.code==='EFFECTFUL_INITIALIZATION'));
  }
});
