import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { replaylock } from '../../dist/vite-plugin.js';
import { fixture, put, jsonFiles, until, control, command, library } from '../helpers/dev-fixture.mjs';

// Marker-scoped external oracles, not a sandbox or native-identity proof.
// Patching is harness-only and precedes target import. Immediate exceptions
// may be caught, but the independent latch remains observable to the harness.
function installOwnedOracles(protectedIntrinsics = false) {
  const marker = 126004;
  const names = ['setter', 'method', 'iterator', 'coercion', 'caught-effect'];
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  const setterDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  const arrayLengthDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'length');
  const coercionDescriptor = Object.getOwnPropertyDescriptor(Number.prototype, Symbol.toPrimitive);
  const push = Array.prototype.push;
  const iterator = Array.prototype[Symbol.iterator];
  const valueOf = Number.prototype.valueOf;
  const numberToString = Number.prototype.toString;
  const log = console.log;
  const trip = name => {
    counts[name]++;
    throw new Error(`OWNED126_ORACLE_${name}`);
  };
  const ownValue = (receiver, key) => Object.getOwnPropertyDescriptor(receiver, key)?.value;
  if (protectedIntrinsics) {
    Object.defineProperty(Array.prototype, '0', {
      configurable: true,
      set(value) {
        if (Array.isArray(this) && ownValue(this, '1') === marker && ownValue(this, '2') === marker) trip('setter');
        // Preserve ordinary creation for unrelated infrastructure arrays. The
        // fixture's dense own slots never consult this inherited setter.
        Object.defineProperty(this, '0', { value, writable: true, enumerable: true, configurable: true });
      },
    });
    Array.prototype.push = function (...values) {
      if (values[0] === 'OWNED126_METHOD') trip('method');
      return push.apply(this, values);
    };
    Array.prototype[Symbol.iterator] = function () {
      if (ownValue(this, '0') === 'OWNED126_ITERATOR') trip('iterator');
      return iterator.call(this);
    };
    Object.defineProperty(Number.prototype, Symbol.toPrimitive, {
      configurable: true,
      value(hint) {
        if (valueOf.call(this) === marker) trip('coercion');
        if (coercionDescriptor?.value) return coercionDescriptor.value.call(this, hint);
        return hint === 'string' ? numberToString.call(this) : valueOf.call(this);
      },
    });
  }
  console.log = (...values) => {
    if (values[0] === 'OWNED126_CAUGHT_EFFECT') trip('caught-effect');
    return log.apply(console, values);
  };
  const state = {
    counts,
    control(name) {
      // Throwaway receivers only: no rejected application module is imported.
      if (name === 'setter') { const missing = [, marker, marker]; missing[0] = 1; }
      else if (name === 'method') [].push('OWNED126_METHOD');
      else if (name === 'iterator') { const [ignored] = ['OWNED126_ITERATOR']; void ignored; }
      else if (name === 'coercion') { const boxed = new Number(marker); void (boxed * 2); }
      else if (name === 'caught-effect') console.log('OWNED126_CAUGHT_EFFECT');
      else throw new Error('Unknown synthetic oracle');
    },
    check() {
      for (const name of names) if (counts[name]) throw new Error(`OWNED126_ORACLE_${name}`);
    },
    restore() {
      if (setterDescriptor) Object.defineProperty(Array.prototype, '0', setterDescriptor);
      else delete Array.prototype[0];
      // Array.prototype is itself an array: defining index zero grows its own
      // length. Deleting that property does not shrink length automatically.
      Object.defineProperty(Array.prototype, 'length', arrayLengthDescriptor);
      if (coercionDescriptor) Object.defineProperty(Number.prototype, Symbol.toPrimitive, coercionDescriptor);
      else delete Number.prototype[Symbol.toPrimitive];
      Array.prototype.push = push;
      Array.prototype[Symbol.iterator] = iterator;
      console.log = log;
      delete globalThis.__owned126Oracles;
    },
  };
  globalThis.__owned126Oracles = state;
}

const oracleNames = ['setter', 'method', 'iterator', 'coercion', 'caught-effect'];

function replayOracleConfiguration(positiveControl, protectedIntrinsics = false) {
  const setup = `(${installOwnedOracles.toString()})(${Boolean(positiveControl) || protectedIntrinsics});\n`;
  const exercise = positiveControl ? `try { globalThis.__owned126Oracles.control(${JSON.stringify(positiveControl)}); } catch {}\ntry { globalThis.__owned126Oracles.check(); } finally { globalThis.__owned126Oracles.restore(); }\n` : '';
  const prefix = "import { afterEach as owned126AfterEach, afterAll as owned126AfterAll } from 'vitest';\n" + setup +
    "owned126AfterEach(() => { globalThis.__owned126Oracles.check(); });\n" +
    "owned126AfterAll(() => { globalThis.__owned126Oracles?.restore(); });\n" + exercise;
  // Only generated harness modules are touched, never application source. A
  // failing positive-control verify independently proves this match is real.
  return `export default { plugins: [{ name: 'owned126-external-oracles', enforce: 'post',
    transform(code, id) {
      if (!id.replaceAll('\\\\', '/').match(/\\/\\.replaylock\\/verify\\/dev-(?:replay|validate)-[^/]+\\/replay-\\d+\\.test\\.mjs$/)) return;
      return { code: ${JSON.stringify(prefix)} + code, map: null };
    }
  }] };`;
}

const sources = {
  'literal.js': `const table = [0, 0, 0];
for (let i = 0; i < 3; i++) { table[i] = i * 2; }
export function answer() { return table[2]; }
`,
  // Marker elements are overwritten, so 6 is still the original construction's
  // completion. The inherited setter control has the same marker neighbours,
  // but intentionally lacks its own slot zero. Dense slots must bypass it.
  'length.js': `const scale = 3;
const table = [126004, 126004, 126004];
for (let i = 0; i < table.length; i++) { table[i] = (table[i] - 126003) / (-(-1)) + i * scale + (i % 1) - 1; }
export function answer() { return table[2]; }
`,
};

for (const realm of ['node', 'browser']) {
  test(`${realm}: computed owned tables are naturally recorded, explicitly reviewed and currently requalified before offline replay`, { timeout: 240000 }, async t => {
    const root = await fixture(t, {
      'src/literal.js': sources['literal.js'],
      'src/length.js': sources['length.js'],
      'replaylock.config.mjs': 'export default { capture: { retention: false } };',
      'vite.config.mjs': replayOracleConfiguration(),
      'index.html': '<button id="literal">Literal</button><button id="length">Length</button><output id="result"></output><script type="module" src="/src/main.js"></script>',
      'src/main.js': `for (const name of ['literal', 'length']) {
  document.querySelector('#' + name).onclick = async () => {
    const module = await import('./' + name + '.js');
    document.querySelector('#result').textContent = String(module.answer());
  };
}`,
    });
    const scan = await command(root, ['scan', '--dev', '--json']);
    assert.equal(scan.status, 0, scan.output);
    const report = JSON.parse(scan.output).environments.find(item => item.environment === realm);
    assert.ok(report, scan.output);
    // Public admission is checked before import: the baseline's rejection
    // cannot accidentally be turned into a recording by executing the module.
    for (const name of ['literal', 'length']) assert.ok(report.targets.some(target => target.locator.module === `src/${name}.js` && target.locator.namePath.join('.') === 'answer'), scan.output);

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
        await page.addInitScript(installOwnedOracles);
        await page.goto(manifest.url);
        const reload = page.waitForEvent('load');
        await control(manifest, 'start');
        await reload;
        // Independently exercise every installed sentinel before absence is
        // trusted. The original target is not involved in any control.
        for (const name of oracleNames) {
          await page.evaluate(installOwnedOracles, true);
          const observed = await page.evaluate(name => {
            const state = globalThis.__owned126Oracles;
            try { state.control(name); } catch {}
            try { state.check(); return null; } catch (error) { return { message: error.message, count: state.counts[name] }; }
            finally { state.restore(); }
          }, name);
          assert.deepEqual(observed, { message: `OWNED126_ORACLE_${name}`, count: 1 });
          await page.evaluate(installOwnedOracles);
        }
        // Install all protected sentinels before either target's first import.
        // Their absence is observable for the natural calls, but capture itself
        // must refuse this changed-intrinsic host rather than manufacture cases.
        await page.evaluate(installOwnedOracles, true);
        await page.click('#literal');
        await until(async () => (await page.locator('#result').textContent()) === '4');
        await page.click('#length');
        await until(async () => (await page.locator('#result').textContent()) === '6');
        const blockedHost = await until(async () => {
          const status = await control(manifest, 'status');
          return status.report?.blocks?.INTRINSIC_MODIFIED >= 2 && status;
        });
        assert.equal(blockedHost.stored, 0);
        await page.evaluate(() => { try { globalThis.__owned126Oracles.check(); } finally { globalThis.__owned126Oracles.restore(); } });
        const stoppedReload = page.waitForEvent('load');
        const refused = await control(manifest, 'stop');
        assert.equal(refused.candidates, 0);
        await stoppedReload;
        const captureReload = page.waitForEvent('load');
        await control(manifest, 'start');
        await captureReload;
        await page.click('#literal');
        await until(async () => (await page.locator('#result').textContent()) === '4');
        await page.click('#length');
        await until(async () => (await page.locator('#result').textContent()) === '6');
        await page.evaluate(() => { try { globalThis.__owned126Oracles.check(); } finally { globalThis.__owned126Oracles.restore(); } });
        assert.deepEqual(pageErrors, []);
      } else {
        await control(manifest, 'start');
        for (const name of oracleNames) {
          installOwnedOracles(true);
          const state = globalThis.__owned126Oracles;
          try {
            try { state.control(name); } catch {}
            assert.equal(state.counts[name], 1);
            assert.throws(() => state.check(), new RegExp(`OWNED126_ORACLE_${name}`));
          } finally { state.restore(); }
        }
        const application = createHttpServer(async (request, response) => {
          try {
            const name = request.url === '/literal' ? 'literal' : 'length';
            const renderer = await vite.ssrLoadModule(`/src/${name}.js`);
            response.end(String(renderer.answer()));
          } catch {
            response.statusCode = 500;
            response.end('synthetic application error');
          }
        });
        await new Promise(resolve => application.listen(0, '127.0.0.1', resolve));
        const requestAnswers = async () => {
          for (const [name, expected] of [['literal', '4'], ['length', '6']]) {
            const response = await fetch(`http://127.0.0.1:${application.address().port}/${name}`);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), expected);
          }
        };
        installOwnedOracles(true);
        try {
          await requestAnswers();
          const blockedHost = await control(manifest, 'status');
          assert.ok(blockedHost.report.blocks.INTRINSIC_MODIFIED >= 2);
          assert.equal(blockedHost.stored, 0);
          globalThis.__owned126Oracles.check();
          globalThis.__owned126Oracles.restore();
          const refused = await control(manifest, 'stop');
          assert.equal(refused.candidates, 0);
          await control(manifest, 'start');
          installOwnedOracles();
          await requestAnswers();
          globalThis.__owned126Oracles.check();
        } finally {
          try { globalThis.__owned126Oracles?.restore(); }
          finally { await new Promise(resolve => application.close(resolve)); }
        }
      }
      await until(async () => (await control(manifest, 'status')).stored === 2);
      assert.equal((await control(manifest, 'status')).blocks, 0);
      await control(manifest, 'stop');
      const candidates = await jsonFiles(root, '.replaylock/observations/pending-v2');
      assert.equal(candidates.length, 2);
      for (const [name, expected] of [['literal', 4], ['length', 6]]) {
        const candidate = candidates.find(item => item.locator.module === `src/${name}.js`);
        assert.ok(candidate, JSON.stringify(candidates));
        assert.equal(candidate.environment, realm);
        assert.equal(candidate.provenance.captureStatus, 'complete');
        assert.deepEqual(candidate.locator.namePath, ['answer']);
        assert.deepEqual(candidate.arguments, { kind: 'array', items: [] });
        assert.deepEqual(candidate.trace, []);
        assert.deepEqual(candidate.completion, { kind: 'return', value: { kind: 'number', value: expected } });
      }
      const reviewed = await command(root, ['review'], 'a\na\n');
      assert.equal(reviewed.status, 0, reviewed.output);
      assert.equal((await jsonFiles(root, '.replaylock/cases')).length, 2);
    } finally {
      try { globalThis.__owned126Oracles?.restore(); }
      finally {
        try { await browser?.close(); }
        finally { await vite?.close(); }
      }
    }

    // Establish matched pre-import replay oracles independently, with a latch
    // that survives a caught immediate throw. No target performs these effects.
    for (const name of oracleNames) {
      await put(root, 'vite.config.mjs', replayOracleConfiguration(name));
      const oracle = await command(root, ['verify']);
      assert.equal(oracle.status, 2, oracle.output);
      assert.match(oracle.output, new RegExp(`OWNED126_ORACLE_${name}`));
    }
    await put(root, 'vite.config.mjs', replayOracleConfiguration());
    const verified = await command(root, ['verify']);
    assert.equal(verified.status, 0, verified.output);
    assert.match(verified.output, /Verified 2 V2 case/);

    // Protected prototype sentinels cannot accompany successful replay at this
    // public seam: the existing native-intrinsic guard rejects the harness.
    // This is the #126 host limitation, not zero prototype-effect evidence.
    await put(root, 'vite.config.mjs', replayOracleConfiguration(undefined, true));
    const protectedReplay = await command(root, ['verify']);
    assert.equal(protectedReplay.status, 2, protectedReplay.output);
    assert.match(protectedReplay.output, /INTRINSIC_MODIFIED/);
    assert.doesNotMatch(protectedReplay.output, /Verified 2 V2 case/);
    await put(root, 'vite.config.mjs', replayOracleConfiguration());

    // Equivalent edits pass despite source/digest change.
    await put(root, 'src/literal.js', sources['literal.js'].replace('i * 2', '(i * 2)'));
    await put(root, 'src/length.js', sources['length.js'].replace('i * scale', '(i * scale)'));
    const equivalent = await command(root, ['verify']);
    assert.equal(equivalent.status, 0, equivalent.output);
    assert.match(equivalent.output, /Verified 2 V2 case/);

    // A table-dependent completion mutation must disagree with the actual
    // reviewed scalar, rather than simply rejecting digest inequality.
    for (const changed of [
      sources['literal.js'].replace('i * 2', 'i * 4'),
      sources['literal.js'].replace('i * 2', '0'),
      sources['literal.js'].replace('for (let i = 0; i < 3; i++) { table[i] = i * 2; }\n', ''),
    ]) {
      await put(root, 'src/literal.js', changed);
      const mutation = await command(root, ['verify']);
      assert.equal(mutation.status, 1, mutation.output);
      assert.doesNotMatch(mutation.output, /REPLAY_SAFETY_REGRESSION|OWNED126_ORACLE_/);
      assert.match(mutation.output, /OUTPUT_MISMATCH/);
    }

    // Independently observed 6 also depends on existing-slot reads, division,
    // unary negation and addition/subtraction, not just multiplication.
    await put(root, 'src/literal.js', sources['literal.js']);
    await put(root, 'src/length.js', sources['length.js'].replace('/ (-(-1))', '/ (-(-2))'));
    const arithmeticMutation = await command(root, ['verify']);
    assert.equal(arithmeticMutation.status, 1, arithmeticMutation.output);
    assert.match(arithmeticMutation.output, /OUTPUT_MISMATCH/);
    assert.doesNotMatch(arithmeticMutation.output, /REPLAY_SAFETY_REGRESSION|OWNED126_ORACLE_/);
    await put(root, 'src/length.js', sources['length.js']);

    // Current qualification, not a reviewed case, authorizes import. Each
    // unsafe edit is independently refused; rejected modules are never loaded
    // merely to observe zero counters. The installed replay latches would fail
    // if the known marked effect were reached even inside application catch.
    const unsafeSources = [
      sources['literal.js'].replace('table[i] =', 'table[i + 1] ='),
      sources['literal.js'] + 'export { table };\n',
      sources['literal.js'].replace('table[i] = i * 2;', 'table.push(i);'),
      sources['literal.js'] + "try { console.log('OWNED126_CAUGHT_EFFECT'); } catch {}\n",
      sources['literal.js'].replace('return table[2]', 'return table[3]'),
    ];
    for (const unsafe of unsafeSources) {
      await put(root, 'src/literal.js', unsafe);
      const stale = await command(root, ['verify']);
      assert.equal(stale.status, 2, stale.output);
      assert.match(stale.output, /REPLAY_SAFETY_REGRESSION/);
      assert.doesNotMatch(stale.output, /OWNED126_ORACLE_|Verified 2 V2 case/);
    }
  });
}
