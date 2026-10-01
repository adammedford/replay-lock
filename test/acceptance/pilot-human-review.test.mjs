import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDevCaseId } from '../../dist/dev-artifacts.js';
import { sha256, validatePilotReport } from '../../scripts/pilot-dev-manifest.mjs';
import { validateHumanReviewReport, sessionDigest } from '../../scripts/pilot-human-review-manifest.mjs';

const stamp = '2026-09-30T00:00:00.000Z';
const session = {
  schemaVersion: 1, artifactKind: 'human-review-session', pilotId: 'epic-stack',
  repository: 'https://github.com/epicweb-dev/epic-stack.git', revision: '8473afd804b66dba6a23f317908dc35d1535e90d',
  pilotReportSha256: 'a'.repeat(64), tarballSha256: 'b'.repeat(64),
  cases: [{ caseId: 'c'.repeat(64), artifactSha256: 'd'.repeat(64), callable: 'app/utils/user.ts#isUser', environment: 'node' }],
};
function measured() {
  return {
    schemaVersion: 1, artifactKind: 'human-review-evidence', sessionSha256: sessionDigest(session), session: structuredClone(session),
    reviewMode: 'terminal-interactive', clock: 'performance.now', participant: { id: 'user-local', role: 'user' }, ceilingMs: 2000,
    measurements: [{ caseId: 'c'.repeat(64), startedAt: stamp, finishedAt: '2026-09-30T00:00:01.000Z', reviewMs: 1000, decision: 'accept', note: '' }],
    totalReviewMs: 1000, ceilingExceeded: false,
  };
}

test('human evidence accepts a complete user session linked to trusted pilot artifacts', () => {
  assert.equal(validateHumanReviewReport(measured(), session).totalReviewMs, 1000);
});

test('human evidence rejects wrong digests, cases, participants, timings, ceilings and scripted claims', () => {
  for (const mutate of [
    r => r.session.tarballSha256 = 'e'.repeat(64), r => r.session.revision = '0'.repeat(40),
    r => r.session.pilotReportSha256 = 'e'.repeat(64), r => r.session.cases[0].artifactSha256 = 'e'.repeat(64),
    r => r.sessionSha256 = '0'.repeat(64), r => r.measurements[0].caseId = '0'.repeat(64),
    r => r.measurements = [], r => r.measurements.push(structuredClone(r.measurements[0])),
    r => delete r.measurements[0].reviewMs, r => r.measurements[0].reviewMs = null,
    r => r.measurements[0].reviewMs = -1, r => r.measurements[0].reviewMs = Infinity,
    r => r.measurements[0].finishedAt = '2026-09-29T00:00:00.000Z',
    r => r.measurements[0].finishedAt = '2026-09-30T00:01:00.000Z',
    r => r.measurements[0].decision = 'scripted-accept', r => r.measurements[0].note = '\u001b',
    r => r.ceilingMs = null, r => r.ceilingMs = 0, r => r.ceilingMs = -1,
    r => r.ceilingExceeded = true, r => r.totalReviewMs = 1,
    r => r.participant.id = '', r => r.participant.role = 'agent',
    r => r.reviewMode = 'scripted-synthetic-only', r => r.clock = 'Date.now',
    r => r.humanReviewMs = 1000,
  ]) {
    const copy = measured(); mutate(copy);
    assert.throws(() => validateHumanReviewReport(copy, session));
  }
});

test('a genuine ceiling overrun validates as evidence requiring user review', () => {
  const report = measured(); report.ceilingMs = 500; report.ceilingExceeded = true;
  assert.equal(validateHumanReviewReport(report, session).ceilingExceeded, true);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'replaylock-human-evidence-'));
  const cases = path.join(root, 'cases'); await mkdir(cases);
  const tarball = path.join(root, 'fixture.tgz'), reportFile = path.join(root, 'pilot.json'), output = path.join(root, 'session.json');
  // Synthetic bytes and cases exercise validation only. They are never published as human evidence.
  await writeFile(tarball, 'synthetic-test-package');
  const report = JSON.parse(await readFile(new URL('../../docs/pilots/epic-mutation-2026-09-27.json', import.meta.url)));
  report.replaylock.tarballSha256 = sha256('synthetic-test-package');
  report.pilots[0].installedReplaylockSha256 = report.replaylock.tarballSha256;
  for (const group of report.pilots[0].mutation.callables) {
    const [module, name] = group.callable.split('#');
    for (const environment of ['browser', 'node']) {
      const artifact = {
        schemaVersion: 2, locator: { module, kind: 'export', namePath: [name] }, environment,
        arguments: { kind: 'array', items: [] }, trace: [], completion: { kind: 'return', value: { kind: 'null' } }, comparison: 'exact',
        eligibility: { verdict: 'replayable', reasonCodes: ['ELIGIBLE'] },
        provenance: { sourceGraphDigest: `sha256:${'a'.repeat(64)}`, lockfileDigest: `sha256:${'b'.repeat(64)}`, runtimeProfile: { environment, runtime: environment === 'node' ? '22.19.0' : 'test-browser', timezone: 'UTC', locale: 'en-US' }, captureStatus: 'partial' },
      };
      artifact.caseId = createDevCaseId(artifact);
      await writeFile(path.join(cases, `${artifact.caseId}.json`), JSON.stringify(artifact));
    }
  }
  validatePilotReport(report, { requireBoth: false });
  await writeFile(reportFile, JSON.stringify(report));
  const common = ['--pilot-report', reportFile, '--tarball', tarball, '--cases', cases];
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/pilot-human-review.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
  return { root, cases, tarball, reportFile, output, common, cli };
}

test('preparation accepts valid partial-capture cases, refuses overwrites and keeps artifacts intact', async () => {
  const f = await fixture();
  try {
    const files = await readdir(f.cases), before = await Promise.all(files.map(file => readFile(path.join(f.cases, file), 'utf8')));
    const result = f.cli('--prepare', ...f.common, '--output', f.output);
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /SESSION PREPARED \(6 accepted cases; timing unmeasured\)/);
    const prepared = JSON.parse(await readFile(f.output)); assert.equal(prepared.cases.length, 6);
    assert.ok(prepared.cases.every(entry => typeof entry.artifactSha256 === 'string'));
    assert.notEqual(f.cli('--prepare', ...f.common, '--output', f.output).status, 0);
    assert.notEqual(f.cli('--prepare', ...f.common, '--output', path.join(f.cases, 'new.json')).status, 0);
    assert.deepEqual(await Promise.all(files.map(file => readFile(path.join(f.cases, file), 'utf8'))), before);
    assert.deepEqual(await readdir(f.cases), files);
    const review = f.cli('--review', ...f.common, '--session', f.output, '--participant', 'user', '--ceiling-ms', '2000', '--output', path.join(f.root, 'human.json'));
    assert.notEqual(review.status, 0); assert.match(review.stderr, /TTY/);
    assert.ok(!(await readdir(f.root)).includes('human.json'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

const hasPty = process.platform !== 'win32' && spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
function terminalReview(f, output, mode) {
  const argv = [process.execPath, fileURLToPath(new URL('../../scripts/pilot-human-review.mjs', import.meta.url)), '--review', ...f.common, '--session', f.output, '--participant', 'synthetic-test-participant', '--ceiling-ms', '2000', '--output', output];
  // Synthetic system-boundary inputs test the collector. Test outputs are never human evidence.
  const driver = `import os, pty, select, signal, sys, time
mode = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[2], sys.argv[2:])
transcript = b''
pending = b''
first = b'\\x03' if mode == 'interrupt' else b'agent\\n' if mode == 'invalid' else b'user\\n'
steps = [(b'personally reviewing: ', first)]
if mode == 'success':
    steps.append((b'in milliseconds: ', b'2000\\n'))
    for _ in range(6):
        steps.extend([(b'Timing starts when the artifact appears. ', b'\\n'), (b'Type accept or reject: ', b'accept\\n'), (b'Optional review note (outside timing): ', b'\\n')])
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    if not select.select([fd], [], [], 0.1)[0]:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    transcript += chunk
    pending += chunk
    if steps and steps[0][0] in pending:
        prompt, response = steps.pop(0)
        pending = pending.split(prompt, 1)[1]
        os.write(fd, response)
else:
    os.kill(pid, signal.SIGTERM)
os.waitpid(pid, 0)
os.close(fd)
sys.stdout.buffer.write(transcript)
`;
  const result = spawnSync('python3', ['-c', driver, mode, ...argv], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('an interrupted real terminal removes its reserved output without claiming human timing', { skip: !hasPty }, async () => {
  const f = await fixture();
  try {
    assert.equal(f.cli('--prepare', ...f.common, '--output', f.output).status, 0);
    const transcript = terminalReview(f, path.join(f.root, 'interrupted-test-only.json'), 'interrupt');
    assert.match(transcript, /personally reviewing:/);
    assert.match(transcript, /aborted/i);
    assert.ok(!(await readdir(f.root)).includes('interrupted-test-only.json'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('the real terminal collector completes a synthetic session, rejects invalid participation and preserves existing evidence', { skip: !hasPty }, async () => {
  const f = await fixture();
  try {
    assert.equal(f.cli('--prepare', ...f.common, '--output', f.output).status, 0);
    const invalid = path.join(f.root, 'invalid-test-only.json');
    assert.match(terminalReview(f, invalid, 'invalid'), /participation was not confirmed/);
    assert.ok(!(await readdir(f.root)).includes('invalid-test-only.json'));
    const output = path.join(f.root, 'collector-test-only.json');
    assert.match(terminalReview(f, output, 'success'), /HUMAN REVIEW EVIDENCE RECORDED/);
    const collected = JSON.parse(await readFile(output));
    assert.equal(collected.measurements.length, 6);
    assert.ok(collected.measurements.every(entry => entry.reviewMs > 0 && entry.decision === 'accept'));
    assert.equal(f.cli('--validate', output, '--session', f.output, ...f.common).status, 0);
    const bytes = await readFile(output, 'utf8');
    assert.match(terminalReview(f, output, 'success'), /EEXIST/);
    assert.equal(await readFile(output, 'utf8'), bytes);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('CLI validation rechecks pilot, tarball and exact case bytes after preparation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.cli('--prepare', ...f.common, '--output', f.output).status, 0);
    const prepared = JSON.parse(await readFile(f.output));
    const report = measured(); report.session = prepared; report.sessionSha256 = sessionDigest(prepared);
    report.measurements = prepared.cases.map((entry, index) => ({ caseId: entry.caseId, startedAt: `2026-09-30T00:00:0${index}.000Z`, finishedAt: `2026-09-30T00:00:0${index + 1}.000Z`, reviewMs: 1000, decision: 'accept', note: '' }));
    report.totalReviewMs = 6000;
    const human = path.join(f.root, 'test-only-human.json'); await writeFile(human, JSON.stringify(report));
    const validate = () => f.cli('--validate', human, '--session', f.output, ...f.common);
    assert.equal(validate().status, 0, validate().stderr);
    await writeFile(f.tarball, 'different-package'); assert.match(validate().stderr, /tarball digest/);
    await writeFile(f.tarball, 'synthetic-test-package');
    const caseFile = path.join(f.cases, (await readdir(f.cases))[0]);
    const bytes = await readFile(caseFile, 'utf8'); await writeFile(caseFile, `${bytes}\n`);
    assert.match(validate().stderr, /session provenance changed/);
    await writeFile(caseFile, bytes);
    const artifact = JSON.parse(bytes); artifact.caseId = '0'.repeat(64); await writeFile(caseFile, JSON.stringify(artifact));
    assert.match(validate().stderr, /CASE_ID_MISMATCH/);
    await writeFile(caseFile, bytes);
    await rm(caseFile); assert.match(validate().stderr, /count disagrees/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
