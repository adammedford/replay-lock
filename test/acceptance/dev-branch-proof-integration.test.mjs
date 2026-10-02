import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { replaylock } from '../../dist/vite-plugin.js';
import { fixture, put, jsonFiles, until, control, command, library } from '../helpers/dev-fixture.mjs';

// This is a test oracle for one synthetic logging marker, not a native-effect
// sandbox. Infrastructure logging is untouched. The latch survives a catch in
// the application and is checked by the harness, outside application control.
function installLoggingOracle() {
  const marker = 'BRANCH_PROOF_SYNTHETIC_LOG';
  const original = console.log;
  const state = { reached: false };
  globalThis.__branchProofLoggingOracle = state;
  console.log = (...args) => {
    if (args[0] === marker) {
      state.reached = true;
      throw new Error('BRANCH_PROOF_FORBIDDEN_EFFECT');
    }
    return original.apply(console, args);
  };
  state.check = () => {
    if (state.reached) throw new Error('BRANCH_PROOF_FORBIDDEN_EFFECT');
  };
  state.restore = () => { console.log = original; };
}

function replayOracleConfiguration(positiveControl = false) {
  const setup = `(${installLoggingOracle.toString()})();\n`;
  // The plugin touches only ReplayLock's generated test harness, never target
  // source. Its afterEach assertion is therefore outside application catch.
  // A public verify positive control below MUST fail; a missing transform match
  // or missing hook cannot silently provide evidence of a working sentinel.
  return `export default { plugins: [{
    name: 'synthetic-branch-proof-logging-oracle', enforce: 'post',
    transform(code, id) {
      if (!id.replaceAll('\\\\', '/').match(/\\/\\.replaylock\\/verify\\/dev-(?:replay|validate)-[^/]+\\/replay-\\d+\\.test\\.mjs$/)) return;
      return { code: ${JSON.stringify("import { afterEach as branchProofAfterEach } from 'vitest';\n" + setup +
        (positiveControl ? "try { console.log('BRANCH_PROOF_SYNTHETIC_LOG'); } catch {}\n" : '') +
        "branchProofAfterEach(() => { globalThis.__branchProofLoggingOracle.check(); });\n")} + code, map: null };
    }
  }] };`;
}

const sources = {
  'literal.js': `if (false) { try { console.log('BRANCH_PROOF_SYNTHETIC_LOG'); } catch {} }
export function answer() { return 7; }
`,
  'constant.js': `const mode = 'safe';
if (mode !== 'safe') { try { console.log('BRANCH_PROOF_SYNTHETIC_LOG'); } catch {} }
export function answer() { return 11; }
`,
};

for (const realm of ['node', 'browser']) {
  test(`${realm}: branch-proof recording is explicitly reviewed and verifies offline, with safe edit and stale unsafe guard`, { timeout: 240000 }, async t => {
    const root = await fixture(t, {
      'src/literal.js': sources['literal.js'],
      'src/constant.js': sources['constant.js'],
      'replaylock.config.mjs': 'export default { capture: { retention: false } };',
      'vite.config.mjs': replayOracleConfiguration(),
      'index.html': `<button id="literal">Literal</button><button id="constant">Constant</button><output id="result"></output><script type="module" src="/src/main.js"></script>`,
      'src/main.js': `for (const name of ['literal', 'constant']) {
  document.querySelector('#' + name).onclick = async () => {
    const module = await import('./' + name + '.js');
    document.querySelector('#result').textContent = String(module.answer());
  };
}`,
    });
    const scan = await command(root, ['scan', '--dev', '--json']);
    assert.equal(scan.status, 0, scan.output);
    // Baseline fails here with EFFECTFUL_INITIALIZATION. This public red check
    // intentionally precedes imports: rejected modules are never evaluated.
    const report = JSON.parse(scan.output).environments.find(item => item.environment === realm);
    assert.ok(report, scan.output);
    for (const name of ['literal', 'constant']) {
      assert.ok(report.targets.some(target => target.locator.module === `src/${name}.js` && target.locator.namePath.join('.') === 'answer'), scan.output);
    }

    let vite, browser;
    try {
      vite = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [replaylock({ dev: true })], server: { host: '127.0.0.1', port: 0, fs: { allow: [root, library] } } });
      await vite.listen();
      const manifest = await until(async () => (await jsonFiles(root, '.replaylock/dev'))[0]);
      if (realm === 'browser') {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ timezoneId: 'UTC', locale: 'en-US' });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.addInitScript(installLoggingOracle);
        // Open before start; observe the real startup reload before clicking.
        await page.goto(manifest.url);
        const reload = page.waitForEvent('load');
        await control(manifest, 'start');
        await reload;
        await page.click('#literal');
        await until(async () => (await page.locator('#result').textContent()) === '7');
        await page.click('#constant');
        await until(async () => (await page.locator('#result').textContent()) === '11');
        await page.evaluate(() => globalThis.__branchProofLoggingOracle.check());
        assert.deepEqual(pageErrors, []);
      } else {
        await control(manifest, 'start');
        // A tiny real server application calls its renderer while serving an
        // ordinary request. The test drives HTTP, not the capture target.
        const application = createHttpServer(async (request, response) => {
          try {
            const name = request.url === '/literal' ? 'literal' : 'constant';
            const renderer = await vite.ssrLoadModule(`/src/${name}.js`);
            response.end(String(renderer.answer()));
          } catch {
            response.statusCode = 500;
            response.end('synthetic application error');
          }
        });
        await new Promise(resolve => application.listen(0, '127.0.0.1', resolve));
        installLoggingOracle();
        try {
          for (const [name, expected] of [['literal', '7'], ['constant', '11']]) {
            const response = await fetch(`http://127.0.0.1:${application.address().port}/${name}`);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), expected);
          }
          globalThis.__branchProofLoggingOracle.check();
        } finally {
          globalThis.__branchProofLoggingOracle.restore();
          delete globalThis.__branchProofLoggingOracle;
          await new Promise(resolve => application.close(resolve));
        }
      }
      await until(async () => (await control(manifest, 'status')).stored === 2);
      await control(manifest, 'stop');
      const candidates = await jsonFiles(root, '.replaylock/observations/pending-v2');
      assert.equal(candidates.length, 2);
      for (const [name, expected] of [['literal', 7], ['constant', 11]]) {
        const candidate = candidates.find(item => item.locator.module === `src/${name}.js`);
        assert.ok(candidate, JSON.stringify(candidates));
        assert.equal(candidate.environment, realm);
        assert.deepEqual(candidate.locator.namePath, ['answer']);
        assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
        assert.deepEqual(candidate.trace, []);
        assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: expected } });
      }
      // Explicit decisions only after inspecting every synthetic completion.
      const reviewed = await command(root, ['review'], 'a\na\n');
      assert.equal(reviewed.status, 0, reviewed.output);
      assert.equal((await jsonFiles(root, '.replaylock/cases')).length, 2);
    } finally {
      await browser?.close();
      await vite?.close();
    }

    const verified = await command(root, ['verify']);
    assert.equal(verified.status, 0, verified.output);
    assert.match(verified.output, /Verified 2 V2 case/);

    // C2: throwaway synthetic harness catches the sentinel's immediate throw.
    // Verify must nevertheless fail at the independently latched afterEach.
    // This also proves the oracle plugin really matches both replay realms.
    await put(root, 'vite.config.mjs', replayOracleConfiguration(true));
    const oracle = await command(root, ['verify']);
    assert.equal(oracle.status, 2, oracle.output);
    assert.match(oracle.output, /BRANCH_PROOF_FORBIDDEN_EFFECT/);
    await put(root, 'vite.config.mjs', replayOracleConfiguration());

    // C1: a changed source can still verify; digest inequality is not a blanket
    // rejection, and no previously recorded target was invoked for an oracle.
    await put(root, 'src/literal.js', sources['literal.js'].replace('if (false)', 'if ((false))'));
    await put(root, 'src/constant.js', sources['constant.js'].replace("mode !== 'safe'", "!(mode === 'safe')"));
    const safeEdit = await command(root, ['verify']);
    assert.equal(safeEdit.status, 0, safeEdit.output);
    assert.match(safeEdit.output, /Verified 2 V2 case/);

    // H9: retained reviewed cases cannot authorize newly reachable logging.
    // Do not import the rejected module to assert a zero-effect counter.
    await put(root, 'src/literal.js', sources['literal.js'].replace('if (false)', 'if (true)'));
    const unsafeEdit = await command(root, ['verify']);
    assert.equal(unsafeEdit.status, 2, unsafeEdit.output);
    assert.match(unsafeEdit.output, /REPLAY_SAFETY_REGRESSION/);
    assert.match(unsafeEdit.output, /EFFECTFUL_INITIALIZATION/);
    assert.doesNotMatch(unsafeEdit.output, /BRANCH_PROOF_FORBIDDEN_EFFECT|Verified 2 V2 case/);
  });
}
