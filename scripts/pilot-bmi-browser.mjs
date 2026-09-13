import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2];
assert.ok(url?.startsWith('http://127.0.0.1:'), 'pass the isolated local application URL');
const browser = await chromium.launch({ headless: true });
const blockedRequests = [];
const pageErrors = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1') return route.continue();
    blockedRequests.push(target.origin);
    return route.abort();
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  await page.getByLabel('Height (cm)').fill('170');
  await page.getByLabel('Weight (kg)').fill('70');
  await page.getByLabel('Age').fill('30');
  await page.getByLabel('Gender').selectOption('other');
  await page.getByText('Normal weight', { exact: true }).first().waitFor();
  await page.getByRole('heading', { name: 'AI Health Suggestions' }).waitFor();
  await page.waitForTimeout(1500);
  const result = { status: 'passed', categoryVisible: true, suggestionsVisible: true, blockedRequests, pageErrors };
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
