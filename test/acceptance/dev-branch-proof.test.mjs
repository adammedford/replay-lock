import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { rename, symlink } from 'node:fs/promises';
import { fixture, command, put } from '../helpers/dev-fixture.mjs';
import { analyzeDevProject, createDevProjectCache, transformDevSource } from '../../dist/dev-transform.js';
import { resolveDevOptions } from '../../dist/dev-options.js';

async function scanMatrix(t, cases) {
  const root = await fixture(t, Object.fromEntries(cases.map(([name, source]) => [`src/${name}.js`, `${source}\nexport function answer(){return 7;}`])));
  const result = await command(root, ['scan', '--dev', '--json']);
  assert.equal(result.status, 0, result.output);
  for (const realm of JSON.parse(result.output).environments) for (const [name, , safe] of cases) {
    const module = `src/${name}.js`;
    assert.equal(realm.targets.some(target => target.locator.module === module && target.locator.namePath.join('.') === 'answer'), safe, `${realm.environment}: ${name}`);
    if (!safe) assert.ok(realm.diagnostics.some(item => item.locator.module === module && item.code === 'EFFECTFUL_INITIALIZATION'), `${realm.environment}: ${name} missing rejection`);
  }
}

test('P1/H1: public scan omits only provably dead initializer logging in both realms', async t => {
  const root = await fixture(t, {
    'src/safe.js': 'if (false) console.log("synthetic"); export function answer(){return 7;}',
    'src/unsafe.js': 'if (true) console.log("synthetic"); export function answer(){return 7;}',
  });
  const result = await command(root, ['scan', '--dev', '--json']);
  assert.equal(result.status, 0, result.output);
  for (const realm of JSON.parse(result.output).environments) {
    assert.ok(realm.targets.some(target => target.locator.module === 'src/safe.js'), `${realm.environment}: P1 not admitted`);
    assert.ok(!realm.targets.some(target => target.locator.module === 'src/unsafe.js'));
    assert.ok(realm.diagnostics.some(item => item.locator.module === 'src/unsafe.js' && item.code === 'EFFECTFUL_INITIALIZATION'));
  }
});

test('H10: source, overlays, configuration and lockfile edits discard cached branch admission', async t => {
  const safe = 'const gate=false;if(gate)console.log("synthetic");export function answer(){return 7;}';
  const unsafe = safe.replace('gate=false', 'gate=true');
  const root = await fixture(t, { 'src/answer.js': safe });
  const options = resolveDevOptions(), cache = createDevProjectCache(root, options);
  for (const environment of ['node', 'browser']) {
    const initial = cache.analyze(environment);
    assert.ok(initial.targets.some(target => target.locator.module === 'src/answer.js'));
    const input = { root, id: path.join(root, 'src/answer.js'), code: unsafe, environment, generation: 'proof', options };
    assert.deepEqual(cache.transform(input), transformDevSource(input));
    assert.equal(cache.transform(input).targets.length, 0, 'unsafe HMR overlay must not borrow physical-source proof');
    assert.equal(cache.analyze(environment), initial, 'overlay must not become physical source');
    await put(root, 'src/answer.js', unsafe);
    const changed = cache.analyze(environment);
    assert.notEqual(changed, initial);
    assert.ok(changed.diagnostics.some(item => item.code === 'EFFECTFUL_INITIALIZATION'));
    assert.equal(changed.targets.length, 0);
    await put(root, 'src/answer.js', safe);
    const restored = cache.analyze(environment);
    assert.equal(restored.targets.length, 1);
    await put(root, 'package-lock.json', `{"lockfileVersion":3,"name":"changed-${environment}"}`);
    assert.notEqual(cache.analyze(environment), restored);
    const metadataChanged = cache.analyze(environment);
    await put(root, 'replaylock.config.mjs', `export default {synthetic:"${environment}"};`);
    assert.notEqual(cache.analyze(environment), metadataChanged);
    options.capture.mode = 'annotated';
    assert.equal(cache.analyze(environment).targets.length, 0, 'effective configuration changes must not reuse automatic admission');
    options.capture.mode = 'automatic';
    assert.equal(cache.analyze(environment).targets.length, 1);
  }
});

test('H10: dependency bytes, package resolution, aliases and realm conditions requalify the graph', async t => {
  const safe = 'if(false)console.log("synthetic");export function helper(){return 7;}';
  const unsafe = safe.replace('if(false)', 'if(true)');
  const conditionalManifest = '{"type":"module","exports":{"safe":"./safe.js","danger":"./unsafe.js","default":"./safe.js"}}';
  const root = await fixture(t, {
    'src/answer.js': 'import {helper} from "tiny";export function answer(){return helper();}',
    'node_modules/tiny/package.json': conditionalManifest,
    'node_modules/tiny/safe.js': safe,
    'node_modules/tiny/unsafe.js': unsafe,
  });
  const options = { ...resolveDevOptions(), resolveConditions: { node: ['safe'], browser: ['safe'] } }, cache = createDevProjectCache(root, options);
  const check = (realm, eligible) => {
    const result = cache.analyze(realm);
    assert.deepEqual(result, analyzeDevProject(root, options, realm));
    assert.equal(result.targets.some(target => target.locator.module === 'src/answer.js'), eligible, realm);
    if (!eligible) assert.ok(result.diagnostics.some(item => item.locator.module === 'src/answer.js' && item.code === 'EFFECTFUL_INITIALIZATION'));
  };
  for (const realm of ['node', 'browser']) {
    await put(root, 'node_modules/tiny/package.json', conditionalManifest);
    check(realm, true);
    await put(root, 'node_modules/tiny/safe.js', unsafe); check(realm, false);
    await put(root, 'node_modules/tiny/safe.js', safe); check(realm, true);
    options.resolveConditions = { node: ['danger'], browser: ['danger'] }; check(realm, false);
    options.resolveConditions = { node: ['safe'], browser: ['safe'] }; check(realm, true);
    options.resolveAliases = [{ find: 'tiny', replacement: path.join(root, 'node_modules/tiny/unsafe.js') }]; check(realm, false);
    delete options.resolveAliases; check(realm, true);
    await put(root, 'node_modules/tiny/package.json', '{"type":"module","exports":"./unsafe.js"}'); check(realm, false);
    await put(root, 'node_modules/tiny/package.json', '{"type":"module","exports":"./safe.js"}'); check(realm, true);
  }
});

test('H10: replacement physical locator cannot borrow a formerly safe linked module proof', async t => {
  if (process.platform === 'win32') { t.skip('symlink privileges unavailable in the Windows contract'); return; }
  const root = await fixture(t, {
    'src/answer.js': 'import {helper} from "./linked.js";export function answer(){return helper();}',
    '.modules/safe.js': 'if(false)console.log("synthetic");export function helper(){return 7;}',
    '.modules/unsafe.js': 'if(true)console.log("synthetic");export function helper(){return 7;}',
  });
  await symlink(path.join(root, '.modules/safe.js'), path.join(root, 'src/linked.js'));
  const options = resolveDevOptions(), cache = createDevProjectCache(root, options);
  for (const realm of ['node', 'browser']) assert.ok(cache.analyze(realm).targets.some(target => target.locator.module === 'src/answer.js'));
  await rename(path.join(root, 'src/linked.js'), path.join(root, '.modules/old-link.js'));
  await symlink(path.join(root, '.modules/unsafe.js'), path.join(root, 'src/linked.js'));
  for (const realm of ['node', 'browser']) {
    const changed = cache.analyze(realm);
    assert.deepEqual(changed, analyzeDevProject(root, options, realm));
    assert.ok(!changed.targets.some(target => target.locator.module === 'src/answer.js'));
    assert.ok(changed.diagnostics.some(item => item.locator.module === 'src/answer.js' && item.code === 'EFFECTFUL_INITIALIZATION'));
  }
});

test('H2/H3/H4/H6/H8: unsupported guards and independently reachable effects remain rejected', async t => {
  await scanMatrix(t, [
    ['call-false', 'function gate(){return false;}if(gate())console.log("synthetic");', false],
    ['getter', 'const gate={get value(){return false;}};if(gate.value)console.log("synthetic");', false],
    ['proxy', 'const gate=new Proxy({}, {get(){return false;}});if(gate.value)console.log("synthetic");', false],
    ['ambient', 'if(typeof globalThis.flag === "undefined")console.log("synthetic");', false],
    ['environment', 'if(process.env.MODE === "off")console.log("synthetic");', false],
    ['reassigned-alias', 'const original=false;let gate=original;gate=true;if(gate)console.log("synthetic");', false],
    ['reassigned-const', 'const gate=false;try{gate=true;}catch{}if(gate)console.log("synthetic");', false],
    ['block-local', '{const gate=false;if(gate)console.log("synthetic");}', false],
    ['filesystem', 'import {readFileSync} from "node:fs";if(true)readFileSync("synthetic-file");', false],
    ['network', 'if(true)fetch("https://example.invalid/");', false],
    ['timer', 'if(true)setTimeout(()=>{},1);', false],
    ['listener', 'if(true)globalThis.addEventListener("synthetic",()=>{});', false],
    ['dom', 'if(true)document.body.appendChild(document.createElement("div"));', false],
    ['global', 'if(true)globalThis.synthetic=1;', false],
    ['prototype', 'if(true)Array.prototype.synthetic=1;', false],
    ['try-reachable', 'try{console.log("synthetic");}catch{}', false],
    ['try-unknown', 'try{if(unknown)console.log("synthetic");}catch{}', false],
    ['try-inner-dead-unsupported', 'try{if(false)console.log("synthetic");}catch{}', false],
    ['loop-unsupported', 'while(false){console.log("synthetic");}', false],
    ['outer-dead-try', 'if(false){try{console.log("synthetic");}catch{}}', true],
  ]);
});

test('H7: a dead local branch never hides transitive or side-effect import initialization', async t => {
  const root = await fixture(t, {
    'src/effect.js': 'console.log("synthetic");export const gate=false;',
    'src/middle.js': 'import "./effect.js";export function helper(){return 7;}',
    'src/bare.js': 'import "./effect.js";if(false)console.log("dead");export function answer(){return 7;}',
    'src/transitive.js': 'import {helper} from "./middle.js";if(false)console.log("dead");export function answer(){return helper();}',
    'src/imported.js': 'import {gate} from "./effect.js";if(gate)console.log("synthetic");export function answer(){return 7;}',
    'src/pure.js': 'export const gate=false;',
    'src/imported-pure.js': 'import {gate} from "./pure.js";if(gate)console.log("synthetic");export function answer(){return 7;}',
  });
  const result = await command(root, ['scan', '--dev', '--json']);
  assert.equal(result.status, 0, result.output);
  for (const realm of JSON.parse(result.output).environments) for (const name of ['bare', 'transitive', 'imported', 'imported-pure']) {
    assert.ok(!realm.targets.some(target => target.locator.module === `src/${name}.js`));
    assert.ok(realm.diagnostics.some(item => item.locator.module === `src/${name}.js` && item.code === 'EFFECTFUL_INITIALIZATION'));
  }
});

test('H11: unreachable initializer execution does not prune callable bodies, policies or hoisted lexical bindings', async t => {
  const root = await fixture(t, {
    'src/policies.js': 'if(false){\n/** @replaylock capture extra */\nfunction invalid(){return 7;}\nfunction* generator(){yield 7;}function logs(){console.log("synthetic");}var gate=true;}if(gate)console.log("reachable");export function answer(){return 7;}',
  });
  const result = await command(root, ['scan', '--dev', '--json']);
  assert.equal(result.status, 0, result.output);
  for (const realm of JSON.parse(result.output).environments) {
    const rejected = (name, code) => realm.diagnostics.some(item => item.locator.namePath.join('.') === name && item.code === code);
    assert.ok(rejected('invalid', 'INVALID_POLICY'));
    assert.ok(rejected('generator', 'UNSUPPORTED_CALLABLE'));
    assert.ok(rejected('logs', 'LOGGING'));
    assert.ok(rejected('answer', 'EFFECTFUL_INITIALIZATION'));
  }
});

test('P4/H5: short-circuit and conditional paths preserve evaluated guards and primitive values', async t => {
  await scanMatrix(t, [
    ['and-dead', 'false && console.log("synthetic");', true],
    ['and-reachable', 'true && console.log("synthetic");', false],
    ['or-dead', '"ready" || console.log("synthetic");', true],
    ['or-reachable', '"" || console.log("synthetic");', false],
    ['conditional-dead', 'false ? console.log("synthetic") : 7;', true],
    ['conditional-reachable', 'true ? console.log("synthetic") : 7;', false],
    ['logical-value', 'if(("" || "off")==="on")console.log("synthetic");', true],
    ['logical-value-opposite', 'if(("ready" && "on")==="on")console.log("synthetic");', false],
    ['unknown-and-false', '(console.log("synthetic") && false) && console.log("other");', false],
    ['unknown-or-true', '(console.log("synthetic") || true) || console.log("other");', false],
    ['effectful-test', 'console.log("synthetic") ? 1 : 2;', false],
    ['unknown-inner-dead', 'const state={flag:false};state.flag && (false && console.log("synthetic"));', true],
  ]);
});

test('P3: finite primitive truthiness, negation and strict comparisons have opposite hazard controls', async t => {
  await scanMatrix(t, [
    ['not-true', 'if(!true)console.log("synthetic");', true],
    ['not-false', 'if(!false)console.log("synthetic");', false],
    ['empty-string', 'if("")console.log("synthetic");', true],
    ['nonempty-string', 'if("false")console.log("synthetic");', false],
    ['zero', 'if(0)console.log("synthetic");', true],
    ['negative-number', 'if(-2)console.log("synthetic");', false],
    ['null', 'if(null)console.log("synthetic");', true],
    ['negative-zero-equal', 'if(-0===0){}else console.log("synthetic");', true],
    ['negative-zero-unequal', 'if(-0!==0){}else console.log("synthetic");', false],
    ['const-comparison', 'const gate="off";if((gate)==="on")console.log("synthetic");', true],
    ['const-opposite', 'const gate="on";if(gate==="on")console.log("synthetic");', false],
    ['strict-different-types', 'if(0==="0")console.log("synthetic");', true],
    ['loose-comparison', 'if(0==="0"){};if(0=="0")console.log("synthetic");', false],
    ['arithmetic-unknown', 'if(1-1)console.log("synthetic");', false],
    ['bigint-unknown', 'if(0n)console.log("synthetic");', false],
    ['undefined-unknown', 'if(undefined)console.log("synthetic");', false],
    ['nonfinite-unknown', 'if(1e400===1e400){}else console.log("synthetic");', false],
  ]);
});

test('P2/H3/H4: only exact earlier initialized module const bindings prove a dead branch', async t => {
  await scanMatrix(t, [
    ['const-false', 'const gate=false; if(gate)console.log("synthetic");', true],
    ['const-true', 'const gate=true; if(gate)console.log("synthetic");', false],
    ['later', 'if(gate)console.log("synthetic"); const gate=false;', false],
    ['shadowed', 'const gate=false; {if(gate)console.log("synthetic");const gate=true;}', false],
    ['cyclic', 'const gate=other; const other=gate; if(gate)console.log("synthetic");', false],
    ['conditional-init', 'if(unknown){var gate=false;} if(gate)console.log("synthetic");', false],
    ['mutable-let', 'let gate=false; if(gate)console.log("synthetic");', false],
    ['mutable-var', 'var gate=false; if(gate)console.log("synthetic");', false],
    ['object', 'const gate={value:false}; if(gate.value)console.log("synthetic");', false],
    ['destructured', 'const {gate=false}={}; if(gate)console.log("synthetic");', false],
  ]);
});
