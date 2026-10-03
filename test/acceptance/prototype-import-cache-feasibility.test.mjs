// RETAINED #127 FAILURE CHARACTERIZATION, not a satisfied admission contract.
// These passing tests reproduce the failed H8 requirement. No adapter is fixed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startImportWorkflow } from '../../scripts/prototype-import-workflow.mjs';
import { openFirstRecordingPage } from '../helpers/import-workflow.mjs';
import { chromium } from 'playwright';

test('load-only Node placement fails warm-generation refusal while cold source refusal works', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow();
  try {
    const positive = await fetch(`${workflow.url}/invoke`);
    assert.equal(positive.status, 200);
    assert.deepEqual(await positive.json(), { value: 7 });
    const unchanged = await fetch(`${workflow.url}/invoke`);
    assert.equal(unchanged.status, 200);
    assert.deepEqual(await unchanged.json(), { value: 7 });
    // Unsupported but harmless: no native effect is executed even if placement fails.
    await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 4; export const unused = { value: 0 };');
    const changed = await fetch(`${workflow.url}/invoke`);
    assert.equal(changed.status, 200, 'Characterize the failed requirement, not successful prevention');
    assert.deepEqual(await changed.json(), { value: 7 });
    // Existing stop invalidates server caches; it is not an admission fix.
    // No observations from this feasibility probe are reviewed or accepted.
    await workflow.stop();
    const cold = await fetch(`${workflow.url}/invoke`);
    assert.equal(cold.status, 409);
    assert.deepEqual(await cold.json(), { code: 'GRAPH_REFUSED' });
  } finally { await workflow.close(); }
});

test('load-only Chromium placement fails page and server cache refusal while cold source refusal works', { timeout: 60000 }, async () => {
  const workflow = await startImportWorkflow();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await openFirstRecordingPage(page, workflow.url);
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), '7');
    // Keep this admitted page alive, without replacing URLs or forcing reload.
    await writeFile(path.join(workflow.root, 'helper.mjs'), 'export const scalar = 4; export const unused = { value: 0 };');
    // Reset only trusted UI state, so a stale output cannot satisfy this click.
    await page.locator('output').evaluate(output => { output.textContent = ''; delete output.dataset.settled; });
    await page.locator('button').click({ timeout: 1000 });
    await page.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('output').textContent(), '7');
    const fresh = await browser.newPage();
    await fresh.goto(workflow.url);
    const [cached] = await Promise.all([
      fresh.waitForResponse(response => new URL(response.url()).pathname === '/entry.mjs', { timeout: 5000 }),
      fresh.locator('button').click({ timeout: 1000 }),
    ]);
    assert.equal(cached.status(), 200);
    await fresh.locator('output[data-settled]').waitFor({ timeout: 5000 });
    assert.equal(await fresh.locator('output').textContent(), '7');
    // A fresh page alone still receives the server's old transformed modules.
    // Existing stop invalidates that cache; no forced cache-busting URL is used.
    await workflow.stop();
    const cold = await browser.newPage();
    await cold.goto(workflow.url);
    const [response, rejected] = await Promise.all([
      cold.waitForResponse(response => new URL(response.url()).pathname === '/entry.mjs', { timeout: 5000 }),
      cold.waitForEvent('pageerror', { timeout: 5000 }),
      cold.locator('button').click({ timeout: 1000 }),
    ]);
    // This middleware host exposes load refusal as404, not a typed gate reason.
    assert.equal(response.status(), 404);
    assert.match(rejected.message, /Failed to fetch dynamically imported module/);
    assert.equal(await cold.locator('output').textContent(), '');
  } finally {
    try { await browser?.close(); } finally { await workflow.close(); }
  }
});
