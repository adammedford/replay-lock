import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startImportWorkflow } from '../../scripts/prototype-import-workflow.mjs';
import { command } from '../helpers/dev-fixture.mjs';
import { openFirstRecordingPage } from '../helpers/import-workflow.mjs';
import { chromium } from 'playwright';

async function reviewPositive(workflow, realm) {
  const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
  const names = await readdir(directory);
  assert.equal(names.length, 1);
  const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
  assert.equal(candidate.environment, realm);
  assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
  assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
  assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
  assert.equal(candidate.provenance.captureStatus, 'complete');
  assert.equal(candidate.trace.length, 0);
  const reviewed = await command(workflow.root, ['review'], 'a\n');
  assert.equal(reviewed.status, 0, reviewed.output);
  const verified = await command(workflow.root, ['verify']);
  assert.equal(verified.status, 0, verified.output);
}

test('owned Node turns refuse warm drift irreversibly and preserve reviewed public behavior', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  try {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${workflow.url}/invoke`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { value: 7 });
    }
    const helper = path.join(workflow.root, 'helper.mjs');
    await writeFile(helper, 'export const scalar = 4; export const unused = { value: 0 };');
    const changed = await fetch(`${workflow.url}/invoke`);
    assert.equal(changed.status, 409);
    assert.deepEqual(await changed.json(), { code: 'GENERATION_CLOSED' });
    await writeFile(helper, 'export const scalar = 3;');
    const restored = await fetch(`${workflow.url}/invoke`);
    assert.equal(restored.status, 409);
    assert.deepEqual(await restored.json(), { code: 'GENERATION_CLOSED' });
    await workflow.stop();
    await reviewPositive(workflow, 'node');
  } finally { await workflow.close(); }
});

test('owned Chromium positive is inspected, explicitly reviewed and verified by the ordinary browser worker', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const invalid = await fetch(`${workflow.url}/__fixture_generation/finish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(invalid.status, 409);
    assert.deepEqual(await invalid.json(), { code: 'TURN_INVALID' });
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), '7');
    await workflow.waitForObservation();
    await workflow.stop();
    await browser.close(); browser = undefined;
    await workflow.shutdown();
    await reviewPositive(workflow, 'browser');
  } finally {
    try { await browser?.close(); } finally { await workflow.close(); }
  }
});

test('owned Chromium reports completion transport failure and always settles the UI', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/__fixture_generation/finish', route => route.abort());
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled][data-refused]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), 'HOST_FAILURE');
    // An abandoned turn is not reused or reviewed; close its host independently.
  } finally {
    try { await browser?.close(); } finally { await workflow.close(); }
  }
});

test('owned Chromium turn finishes admitted bytes after mid-turn drift and refuses subsequent reuse', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow({ ownedTurns: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let edited = false;
    const premature = await fetch(`${workflow.url}/entry.mjs`);
    assert.equal(premature.status, 409, 'Application delivery requires an admitted live turn');
    await page.route('**/__fixture_generation/begin', async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 4; export const unused = { value: 0 };');
      edited = true;
      await route.fulfill({ response });
    });
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(edited, true, 'Edit must occur after server admission, before browser load');
    assert.equal(await page.locator('output').textContent(), '7');
    await page.unroute('**/__fixture_generation/begin');
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-refused]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), 'GENERATION_CLOSED');
    const fresh = await browser.newPage();
    await fresh.goto(workflow.url);
    await fresh.locator('button').click({ timeout: 1000 });
    await fresh.locator('output[data-refused]').waitFor({ timeout: 5000 });
    assert.equal(await fresh.locator('output').textContent(), 'GENERATION_CLOSED');
    // No mid-turn-drift observation is reviewed: its provenance needs a separate proof.
  } finally {
    try { await browser?.close(); } finally { await workflow.close(); }
  }
});
