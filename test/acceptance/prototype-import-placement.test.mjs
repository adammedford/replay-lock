import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startPlacementProbe } from '../../scripts/prototype-import-placement.mjs';

// Fixed synthetic source, never a blocked application/dependency import.
const positive = {
  '/entry.mjs': 'import { scalar } from "./helper.mjs"; export function result() { return scalar + 4; }',
  '/helper.mjs': 'export const scalar = 3;',
};
const witness = {
  '/entry.mjs': 'import "./prelude.mjs"; import "./unsupported.mjs"; export function result() { return 7; }',
  '/prelude.mjs': 'throw "SYNTHETIC_PRELUDE_REACHED";',
  '/unsupported.mjs': 'export let mutable = 1;',
};

async function nodeOutcome(probe) {
  const response = await fetch(`${probe.url}/invoke`);
  return { status: response.status, body: await response.json() };
}

async function browserOutcome(browser, probe) {
  const page = await browser.newPage();
  try {
    await page.goto(probe.url);
    await page.locator('button').click();
    await page.locator('output[data-settled]').waitFor();
    return JSON.parse(await page.locator('output').textContent());
  } finally { await page.close(); }
}

async function withBrowserProbe(fixture, run, options) {
  const browser = await chromium.launch({ headless: true });
  try {
    const probe = await startPlacementProbe(fixture, options);
    try { await run(browser, probe); }
    finally { await probe.close(); }
  } finally { await browser.close(); }
}

test('HTTP gate refuses before Vite evaluates any rejected graph sibling', { timeout: 60000 }, async () => {
  const probe = await startPlacementProbe(witness);
  try { assert.deepEqual(await nodeOutcome(probe), { status: 409, body: { code: 'GRAPH_REFUSED' } }); }
  finally { await probe.close(); }
});

test('fresh browser entry gate refuses before evaluating any rejected graph sibling', { timeout: 60000 }, async () => {
  await withBrowserProbe(witness, async (browser, probe) => {
    assert.deepEqual(await browserOutcome(browser, probe), { code: 'GRAPH_REFUSED' });
  });
});

test('direct browser module URLs cannot bypass refused entry admission', { timeout: 60000 }, async () => {
  const probe = await startPlacementProbe(witness);
  try {
    for (const url of ['/entry.mjs', '/prelude.mjs', '/unsupported.mjs']) {
      const response = await fetch(probe.url + url);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { code: 'GRAPH_REFUSED' });
    }
  } finally { await probe.close(); }
});

test('native builtin and data imports are refused before the throw-only sibling', { timeout: 60000 }, async () => {
  for (const specifier of ['node:fs', 'data:text/javascript,throw%20%22ESCAPE%22']) {
    const probe = await startPlacementProbe({
      ...witness,
      '/entry.mjs': `import './prelude.mjs'; import ${JSON.stringify(specifier)}; export function result() { return 7; }`,
    });
    try { assert.deepEqual(await nodeOutcome(probe), { status: 409, body: { code: 'GRAPH_REFUSED' } }); }
    finally { await probe.close(); }
  }
});

test('throw-only control is reachable through ordinary Vite HTTP and browser hosts', { timeout: 60000 }, async () => {
  await withBrowserProbe({ '/entry.mjs': 'throw "SYNTHETIC_PRELUDE_REACHED";' }, async (browser, probe) => {
    assert.deepEqual(await nodeOutcome(probe), { status: 409, body: { code: 'SYNTHETIC_PRELUDE_REACHED' } });
    assert.deepEqual(await browserOutcome(browser, probe), { code: 'SYNTHETIC_PRELUDE_REACHED' });
  }, { witnessControl: true });
});

test('original scalar graph preserves result 7 through HTTP, cache reuse and a browser click', { timeout: 60000 }, async () => {
  await withBrowserProbe(positive, async (browser, probe) => {
    assert.deepEqual(await nodeOutcome(probe), { status: 200, body: { value: 7, sameNamespace: true } });
    assert.deepEqual(await nodeOutcome(probe), { status: 200, body: { value: 7, sameNamespace: true } });
    assert.deepEqual(await browserOutcome(browser, probe), { value: 7, sameNamespace: true });
  });
});
