import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openFirstRecordingPage } from '../helpers/import-workflow.mjs';
import { command } from '../helpers/dev-fixture.mjs';
import { verifyAttached } from '../../scripts/prototype-import-evaluator-attachment.mjs';
// Must precede the ordinary host's dynamic import and its analysis-client import.
await import('../../scripts/prototype-import-analysis-bootstrap.mjs');
const { startImportWorkflow } = await import('../../scripts/prototype-import-workflow.mjs');

test('prepared Node instrumentation refuses changed actual output but does not certify downstream delivery', { timeout: 60000 }, async () => {
  for (const mode of ['unguarded-mutate', 'mutate', 'release', 'downstream-mutate']) {
    const workflow = await startImportWorkflow({ ownedTurns: true, sealedAnalysis: true,
      preparedAnalysis: mode === 'downstream-mutate' ? 'release' : mode,
      ...(['release', 'downstream-mutate'].includes(mode) ? { liveAttachment: mode === 'release' ? 'release' : 'mutate',
        nativeRecipeIdentity: process.platform === 'darwin' && process.arch === 'arm64' } : {}) });
    try {
      const response = await fetch(`${workflow.url}/invoke`);
      assert.equal(response.status, mode === 'mutate' ? 409 : 200);
      assert.deepEqual(await response.json(), mode === 'mutate'
        ? { code: 'GRAPH_REFUSED' } : { value: mode === 'release' ? 7 : 8 });
      if (mode !== 'mutate') await workflow.waitForObservation();
      await workflow.stop();
      const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
      const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      assert.equal(names.length, mode === 'mutate' ? 0 : 1);
      if (mode !== 'mutate') {
        const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
        assert.equal(candidate.environment, 'node');
        assert.equal(candidate.provenance.captureStatus, 'complete');
        assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
        assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
        assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: mode === 'release' ? 7 : 8 } });
        assert.deepEqual(candidate.trace, []);
        if (mode === 'release') {
          const reviewed = await command(workflow.root, ['review'], 'a\n');
          assert.equal(reviewed.status, 0, reviewed.output);
          const verified = await command(workflow.root, ['verify']);
          assert.equal(verified.status, 0, verified.output);
        }
      }
      // Neither mutated candidate is reviewed; downstream 8 is an exposed gap.
    } finally { await workflow.close(); }
  }
});

test('final Node fixture comparison withholds the whole prepared closure and refuses identical late drift', {
  timeout: 60000, skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async () => {
  for (const mode of ['unguarded-mutate', 'mutate', 'withheld-mutate', 'release']) {
    const workflow = await startImportWorkflow({ ownedTurns: true, sealedAnalysis: true, preparedAnalysis: 'release',
      nativeRecipeIdentity: true, finalNode: mode,
      liveAttachment: ['mutate', 'unguarded-mutate'].includes(mode) ? 'mutate' : 'release' });
    try {
      const response = await fetch(`${workflow.url}/invoke`);
      const rejected = ['mutate', 'withheld-mutate'].includes(mode);
      assert.equal(response.status, rejected ? 409 : 200);
      assert.deepEqual(await response.json(), rejected ? { code: 'EVALUATED_INPUT_REFUSED' } : { value: mode === 'release' ? 7 : 8 });
      if (!rejected) await workflow.waitForObservation();
      // Warm namespace bypass is refused, rather than claimed to be validated.
      if (!rejected) {
        const warm = await fetch(`${workflow.url}/invoke`);
        assert.equal(warm.status, 409);
        assert.deepEqual(await warm.json(), { code: 'EVALUATED_INPUT_REFUSED' });
      }
      for (const url of ['/entry.mjs', `/@fs${workflow.root}/helper.mjs`, '/%65ntry.mjs', '/index.html']) {
        const client = await fetch(workflow.url + url);
        assert.equal(client.status, 409);
        assert.deepEqual(await client.json(), { code: 'GRAPH_REFUSED' });
      }
      await workflow.stop();
      const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
      const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      assert.equal(names.length, rejected ? 0 : 1);
      if (!rejected) {
        const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
        assert.equal(candidate.environment, 'node');
        assert.equal(candidate.provenance.captureStatus, 'complete');
        assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
        assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
        assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: mode === 'release' ? 7 : 8 } });
        assert.deepEqual(candidate.trace, []);
        if (mode === 'release') {
          const reviewed = await command(workflow.root, ['review'], 'a\n');
          assert.equal(reviewed.status, 0, reviewed.output);
          const verified = await command(workflow.root, ['verify']);
          assert.equal(verified.status, 0, verified.output);
        }
      }
    } finally { await workflow.close(); }
  }
});

test('native recipe acquisition refuses override selectors before the fixture opens admission', {
  timeout: 60000, skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async () => {
  for (const [key, value] of [['NAPI_RS_NATIVE_LIBRARY_PATH', '/not-an-authorized-binding.node'],
    ['NAPI_RS_FORCE_WASI', 'true'], ['NAPI_RS_WASI_FLAVOR', 'wasm32-wasi']]) {
    const previous = process.env[key];
    let unexpectedWorkflow;
    try {
      // Vite has already loaded its binding: cached selection must not bypass
      // admission's environment refusal. No application HTTP request is made.
      process.env[key] = value;
      await assert.rejects(async () => {
        unexpectedWorkflow = await startImportWorkflow({ ownedTurns: true, liveAttachment: 'release', nativeRecipeIdentity: true });
      },
        error => error.code === 'NATIVE_RECIPE_REFUSED');
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      await unexpectedWorkflow?.close();
    }
  }
});

test('sealed live analysis records an admitted browser turn after drift and refuses the next turn', { timeout: 60000 }, async () => {
  const baseline = await startImportWorkflow({ ownedTurns: true });
  let expectedDigest;
  let baselineBrowser;
  try {
    baselineBrowser = await chromium.launch({ headless: true });
    const page = await baselineBrowser.newPage();
    await openFirstRecordingPage(page, baseline.url);
    await page.locator('button').click();
    await page.locator('output[data-settled]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('output').textContent(), '7');
    await baseline.waitForObservation();
    await baseline.stop();
    const directory = path.join(baseline.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    expectedDigest = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8')).provenance.sourceGraphDigest;
  } finally { await baselineBrowser?.close(); await baseline.close(); }
  const workflow = await startImportWorkflow({ ownedTurns: true, sealedAnalysis: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await openFirstRecordingPage(page, workflow.url);
    await page.route('**/entry.mjs', async route => {
      await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 4;');
      await route.continue();
    });
    await page.locator('button').click();
    await page.locator('output[data-settled]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('output').textContent(), '7');
    await workflow.waitForObservation();
    const next = await fetch(`${workflow.url}/invoke`);
    assert.equal(next.status, 409);
    assert.deepEqual(await next.json(), { code: 'GENERATION_CLOSED' });
    await workflow.stop();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'browser');
    assert.equal(candidate.provenance.captureStatus, 'complete');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
    assert.deepEqual(candidate.trace, []);
    assert.equal(candidate.provenance.sourceGraphDigest, expectedDigest);
    // The drifted turn is inspected but never reviewed or accepted.
  } finally { await browser?.close(); await workflow.close(); }
});

test('ordinary Node replay seals only after physical preflight and preserves unsafe source refusal', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  try {
    const response = await fetch(`${workflow.url}/invoke`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: 7 });
    await workflow.waitForObservation();
    await workflow.stop();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'node');
    assert.equal(candidate.provenance.captureStatus, 'complete');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
    assert.deepEqual(candidate.trace, []);
    const reviewed = await command(workflow.root, ['review'], 'a\n');
    assert.equal(reviewed.status, 0, reviewed.output);
    const released = await verifyAttached(workflow.root, 'release', { analysisMode: 'release' });
    assert.equal(released.status, 0, released.output);
    const refused = await verifyAttached(workflow.root, 'release', { analysisMode: 'refuse' });
    assert.equal(refused.status, 2, refused.output);
    assert.match(refused.output, /REPLAY_ANALYSIS_REFUSED/);
    assert.equal(refused.output.includes('OUTPUT_MISMATCH'), false);
    await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 3; console.log("UNSAFE_INITIALIZER");');
    const unsafe = await verifyAttached(workflow.root, 'release', { analysisMode: 'refuse' });
    assert.equal(unsafe.status, 2, unsafe.output);
    assert.match(unsafe.output, /GRAPH_REFUSED/);
    assert.equal(unsafe.output.includes('REPLAY_ANALYSIS_REFUSED'), false);
    assert.equal(unsafe.output.includes('UNSAFE_INITIALIZER'), false);
    const originalUnsafe = await command(workflow.root, ['verify']);
    assert.equal(originalUnsafe.status, 2, originalUnsafe.output);
    assert.match(originalUnsafe.output, /GRAPH_REFUSED/);
  } finally { await workflow.close(); }
});

test('ordinary browser replay uses post-preflight sealed analysis and preserves unsafe source refusal', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click();
    await page.locator('output[data-settled]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('output').textContent(), '7');
    await workflow.waitForObservation();
    await workflow.stop();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'browser');
    assert.equal(candidate.provenance.captureStatus, 'complete');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
    assert.deepEqual(candidate.trace, []);
    await browser.close(); browser = undefined;
    await workflow.shutdown();
    const reviewed = await command(workflow.root, ['review'], 'a\n');
    assert.equal(reviewed.status, 0, reviewed.output);
    const released = await verifyAttached(workflow.root, 'release', { analysisMode: 'release' });
    assert.equal(released.status, 0, released.output);
    const refused = await verifyAttached(workflow.root, 'release', { analysisMode: 'refuse' });
    assert.equal(refused.status, 2, refused.output);
    assert.match(refused.output, /REPLAY_ANALYSIS_REFUSED/);
    assert.equal(refused.output.includes('OUTPUT_MISMATCH'), false);
    await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 3; console.log("UNSAFE_INITIALIZER");');
    const unsafe = await verifyAttached(workflow.root, 'release', { analysisMode: 'refuse' });
    assert.equal(unsafe.status, 2, unsafe.output);
    assert.match(unsafe.output, /GRAPH_REFUSED/);
    assert.equal(unsafe.output.includes('REPLAY_ANALYSIS_REFUSED'), false);
    assert.equal(unsafe.output.includes('UNSAFE_INITIALIZER'), false);
    const originalUnsafe = await command(workflow.root, ['verify']);
    assert.equal(originalUnsafe.status, 2, originalUnsafe.output);
    assert.match(originalUnsafe.output, /GRAPH_REFUSED/);
  } finally { await browser?.close(); await workflow.close(); }
});

test('sealed live Node analysis preserves natural inspected review and ordinary offline verify', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true, sealedAnalysis: true });
  try {
    const response = await fetch(`${workflow.url}/invoke`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: 7 });
    await workflow.waitForObservation();
    await workflow.stop();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'node');
    assert.equal(candidate.provenance.captureStatus, 'complete');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
    assert.deepEqual(candidate.trace, []);
    const reviewed = await command(workflow.root, ['review'], 'a\n');
    assert.equal(reviewed.status, 0, reviewed.output);
    const verified = await command(workflow.root, ['verify']);
    assert.equal(verified.status, 0, verified.output);
    // New analysis discovery inputs also invalidate, not just the entry closure.
    await writeFile(path.join(workflow.root, 'unrelated.mjs'), 'export const unrelated = 1;');
    const changed = await fetch(`${workflow.url}/invoke`);
    assert.equal(changed.status, 409);
    assert.deepEqual(await changed.json(), { code: 'GENERATION_CLOSED' });
  } finally { await workflow.close(); }
});
