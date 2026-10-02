import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, put, command, digest } from '../helpers/dev-fixture.mjs';
import { createDevCandidate, toDevCase, devArtifactJson } from '../../dist/dev-artifacts.js';
import { encodeDevValue } from '../../dist/dev-values.js';
import { runtimeProfile } from '../../dist/dev-runtime.js';

async function accepted(t, source, configuration = '{}', trace = [], completion = 3, environment = 'node') {
  const root = await fixture(t, {
    'src/target.js': source,
    'replaylock.config.js': `export default ${configuration};`,
  });
  const artifact = toDevCase(createDevCandidate({
    locator: { module: 'src/target.js', kind: 'export', namePath: ['target'] },
    sourceGraphDigest: digest, generation: 'test', environment,
    arguments: encodeDevValue([2]), trace,
    completion: { kind: 'return', value: encodeDevValue(completion) },
  }, digest, environment === 'node' ? runtimeProfile('node') : { environment: 'browser', runtime: 'browser:chromium', timezone: 'UTC', locale: 'en-US' }));
  await put(root, `.replaylock/cases/${artifact.caseId}.json`, devArtifactJson(artifact));
  return root;
}

test('verify applies explicit placeholders before module initialization', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = process.env.REPLAYLOCK_INIT_LABEL.length; export function target(value) { return value + 1; }`,
    `{ replay: { environment: { REPLAYLOCK_INIT_LABEL: 'synthetic-placeholder' } } }`);
  const result = await command(root, ['verify']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Verified 1 V2 case/);
});

test('short-circuited primitive alternatives do not turn into environment proxies', { timeout: 60000 }, async t => {
  for (const environment of ['node', 'browser']) {
    const root = await accepted(t,
      `const unused = 3 ?? import.meta.env; export function target(value) { return value + 1; }`, '{}', [], 3, environment);
    const result = await command(root, ['verify']);
    assert.equal(result.status, 0, result.output);
  }
});

test('Node initialization failures name missing import.meta.env keys', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = import.meta.env.REPLAYLOCK_MISSING_META_LABEL.length; export function target(value) { return value + 1; }`);
  const result = await command(root, ['verify']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /REPLAY_ENVIRONMENT_MISSING.*REPLAYLOCK_MISSING_META_LABEL/);
});

test('browser initialization failures name missing import.meta.env keys', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = import.meta.env.REPLAYLOCK_MISSING_BROWSER_LABEL.length; export function target(value) { return value + 1; }`,
    '{}', [], 3, 'browser');
  const result = await command(root, ['verify']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /REPLAY_ENVIRONMENT_MISSING.*REPLAYLOCK_MISSING_BROWSER_LABEL/);
});

test('browser placeholders initialize modules while invocation reads consume recorded values', { timeout: 60000 }, async t => {
  const trace = [
    { kind: 'call', id: 0, operation: 'import.meta.env', arguments: encodeDevValue(['REPLAYLOCK_BROWSER_LABEL']) },
    { kind: 'return', id: 0, value: encodeDevValue('recorded-browser-value') },
  ];
  const root = await accepted(t,
    `const unused = import.meta.env.REPLAYLOCK_BROWSER_LABEL.length; export function target(value) { return import.meta.env.REPLAYLOCK_BROWSER_LABEL; }`,
    `{ replay: { environment: { REPLAYLOCK_BROWSER_LABEL: 'synthetic-browser-placeholder' } }, effects: { environment: ['REPLAYLOCK_BROWSER_LABEL'] } }`,
    trace, 'recorded-browser-value', 'browser');
  const result = await command(root, ['verify']);
  assert.equal(result.status, 0, result.output);
});

test('failed initialization names missing keys without exposing application error values', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = process.env.REPLAYLOCK_MISSING_INIT_LABEL.length; export function target(value) { return value + 1; }`);
  const result = await command(root, ['verify']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /REPLAY_ENVIRONMENT_MISSING.*REPLAYLOCK_MISSING_INIT_LABEL/);
  assert.match(result.output, /replay.environment/);
});

test('replay placeholders support import.meta.env without enabling invocation reads', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = import.meta.env.REPLAYLOCK_INIT_LABEL.length; export function target(value) { return value + 1; }`,
    `{ replay: { environment: { REPLAYLOCK_INIT_LABEL: 'synthetic-placeholder' } } }`);
  const result = await command(root, ['verify']);
  assert.equal(result.status, 0, result.output);
});

test('invocation environment reads replay their recorded values instead of initialization placeholders', { timeout: 60000 }, async t => {
  const trace = [
    { kind: 'call', id: 0, operation: 'process.env', arguments: encodeDevValue(['REPLAYLOCK_INIT_LABEL']) },
    { kind: 'return', id: 0, value: encodeDevValue('recorded-value') },
  ];
  const root = await accepted(t,
    `const unused = process.env.REPLAYLOCK_INIT_LABEL.length; export function target(value) { return process.env.REPLAYLOCK_INIT_LABEL; }`,
    `{ replay: { environment: { REPLAYLOCK_INIT_LABEL: 'synthetic-placeholder' }, }, effects: { environment: ['REPLAYLOCK_INIT_LABEL'] } }`,
    trace, 'recorded-value');
  const result = await command(root, ['verify']);
  assert.equal(result.status, 0, result.output);
});

test('optional missing initialization keys do not require placeholders', { timeout: 60000 }, async t => {
  const root = await accepted(t,
    `const unused = process.env.REPLAYLOCK_OPTIONAL_INIT_LABEL; export function target(value) { return value + 1; }`);
  const result = await command(root, ['verify']);
  assert.equal(result.status, 0, result.output);
});

test('invalid replay placeholders fail as policy errors without displaying their values', async t => {
  const root = await fixture(t, { 'replaylock.config.js': `export default { replay: { environment: { BAD: 12345 } } };` });
  const result = await command(root, ['scan', '--dev']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /INVALID_POLICY.*replay.environment/);
  assert.doesNotMatch(result.output, /12345/);
});

test('replay environment rejects inherited, prototype, and runtime-managed entries', async t => {
  for (const environment of [
    `new Date()`,
    `Object.create({ REPLAYLOCK_INIT_LABEL: 'hidden-placeholder' })`,
    `Object.fromEntries([['__proto__', 'hidden-placeholder']])`,
    `{ constructor: 'hidden-placeholder' }`,
    `{ NODE_ENV: 'hidden-placeholder' }`,
    `{ NODE_OPTIONS: 'hidden-placeholder' }`,
    `{ TZ: 'hidden-placeholder' }`,
    `{ PROD: 'hidden-placeholder' }`,
    `Object.defineProperty({}, 'REPLAYLOCK_INIT_LABEL', { enumerable: true, get() { throw new Error('hidden-placeholder'); } })`,
    `{ [Symbol('REPLAYLOCK_INIT_LABEL')]: 'hidden-placeholder' }`,
  ]) {
    const root = await fixture(t, { 'replaylock.config.js': `export default { replay: { environment: ${environment} } };` });
    const result = await command(root, ['scan', '--dev']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /INVALID_POLICY.*replay.environment/);
    assert.doesNotMatch(result.output, /hidden-placeholder/);
  }
});
