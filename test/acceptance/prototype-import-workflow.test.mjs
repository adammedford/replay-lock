import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startImportWorkflow } from '../../scripts/prototype-import-workflow.mjs';
import { command } from '../helpers/dev-fixture.mjs';
import { openFirstRecordingPage } from '../helpers/import-workflow.mjs';
import { chromium } from 'playwright';

async function verifyEditControls(root) {
  const helper = path.join(root, 'helper.mjs');
  await writeFile(helper, 'export const scalar = 3.0;');
  const equivalent = await command(root, ['verify']);
  assert.equal(equivalent.status, 0, equivalent.output);
  await writeFile(helper, 'export const scalar = 4;');
  const mismatch = await command(root, ['verify']);
  assert.equal(mismatch.status, 1, mismatch.output);
  assert.match(mismatch.output, /OUTPUT_MISMATCH/);
  await writeFile(helper, 'export const scalar = 3;');
}

test('trusted gate configuration travels through natural Node capture, explicit review and real isolated verify', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow();
  try {
    const response = await fetch(`${workflow.url}/invoke`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: 7 });
    await workflow.stop();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    // Inspect the complete candidate before providing any review input.
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'node');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.equal(candidate.completion.kind, 'return');
    assert.deepEqual(candidate.completion.value, { kind: 'number', value: 7 });
    assert.equal(candidate.provenance.captureStatus, 'complete');
    assert.equal(candidate.trace.length, 0);
    const reviewed = await command(workflow.root, ['review'], 'a\n');
    assert.equal(reviewed.status, 0, reviewed.output);
    const verified = await command(workflow.root, ['verify']);
    assert.equal(verified.status, 0, verified.output);
    assert.match(verified.output, /Verified 1 V2 case\(s\)/);
    await verifyEditControls(workflow.root);
    // An unrelated initializer is outside the placement grammar. Its refusal
    // must be reported by the actual isolated gate, not hidden by target-only
    // qualification. No native-effect initializer is used for this probe.
    const filename = path.join(workflow.root, 'entry.mjs');
    const original = await readFile(filename, 'utf8');
    await writeFile(filename, original + '\nexport const unused = { value: 0 };\n');
    const refused = await command(workflow.root, ['verify']);
    assert.equal(refused.status, 2, refused.output);
    assert.match(refused.output, /GRAPH_REFUSED/);
  } finally { await workflow.close(); }
});

test('trusted gate configuration travels through natural Chromium capture and real browser verification', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), '7');
    await workflow.waitForObservation();
    await workflow.stop();
    await browser.close(); browser = undefined;
    await workflow.shutdown();
    const directory = path.join(workflow.root, '.replaylock/observations/pending-v2');
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(directory, names[0]), 'utf8'));
    assert.equal(candidate.environment, 'browser');
    assert.deepEqual(candidate.locator, { module: 'entry.mjs', kind: 'export', namePath: ['result'] });
    assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
    assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: 7 } });
    assert.equal(candidate.trace.length, 0);
    assert.equal(candidate.provenance.captureStatus, 'complete');
    const reviewed = await command(workflow.root, ['review'], 'a\n');
    assert.equal(reviewed.status, 0, reviewed.output);
    const verified = await command(workflow.root, ['verify']);
    assert.equal(verified.status, 0, verified.output);
    assert.match(verified.output, /Verified 1 V2 case\(s\)/);
    await verifyEditControls(workflow.root);
    const filename = path.join(workflow.root, 'entry.mjs');
    const original = await readFile(filename, 'utf8');
    await writeFile(filename, original + '\nexport const unused = { value: 0 };\n');
    const refused = await command(workflow.root, ['verify']);
    assert.equal(refused.status, 2, refused.output);
    assert.match(refused.output, /GRAPH_REFUSED/);
  } finally {
    try { await browser?.close(); } finally { await workflow.close(); }
  }
});
