import assert from 'node:assert/strict';
import { open, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PILOTS, sha256, validatePilotReport } from './pilot-dev-manifest.mjs';
import { sessionDigest, validateHumanReviewSession, validateHumanReviewReport } from './pilot-human-review-manifest.mjs';

const usage = `Human review evidence (Node 22; npm run build first)
  --prepare --pilot-report FILE --tarball FILE --cases DIR --output SESSION
  --review --session SESSION --pilot-report FILE --tarball FILE --cases DIR --participant ID --ceiling-ms NUMBER --output REPORT
  --validate REPORT --session SESSION --pilot-report FILE --tarball FILE --cases DIR
Outputs must be new files outside the accepted case directory. Review requires a terminal and the user. Ceiling is milliseconds per case. No accepted cases are modified.`;
const flags = new Set(['--prepare', '--review', '--validate', '--session', '--pilot-report', '--tarball', '--cases', '--participant', '--ceiling-ms', '--output', '--help']);
function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    assert.ok(flags.has(name) && !Object.hasOwn(parsed, name), `unknown or duplicate option ${name}`);
    if (['--prepare', '--review', '--help'].includes(name)) parsed[name] = true;
    else { const value = argv[++index]; assert.ok(value && !value.startsWith('--'), `missing value for ${name}`); parsed[name] = value; }
  }
  return parsed;
}
async function boundedRead(file, maximum = 10 * 1024 * 1024) {
  assert.ok((await stat(file)).size <= maximum, `oversized input ${file}`);
  const bytes = await readFile(file);
  assert.ok(bytes.length <= maximum, `oversized input ${file}`);
  return bytes;
}
const json = async file => JSON.parse(await boundedRead(file));
const within = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

/** Read accepted artifacts with the same full schema/identity checks as verify. */
async function provenance(settings) {
  for (const flag of ['--pilot-report', '--tarball', '--cases']) assert.ok(settings[flag], `${flag} is required`);
  const reportBytes = await boundedRead(settings['--pilot-report']);
  const report = validatePilotReport(JSON.parse(reportBytes), { requireBoth: false });
  const pilot = report.pilots.find(item => item.id === 'epic-stack');
  assert.ok(pilot?.status === 'passed' && pilot.stages.review.status === 'passed', 'a passed pinned Epic pilot is required');
  assert.equal(report.schemaVersion, 2, 'human review requires mutation pilot evidence');
  const tarballSha256 = sha256(await readFile(settings['--tarball']));
  assert.equal(tarballSha256, report.replaylock.tarballSha256, 'tarball digest disagrees with pilot report');
  const directory = await realpath(settings['--cases']);
  const entries = await readdir(directory, { withFileTypes: true });
  assert.ok(entries.length > 0 && entries.every(entry => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name)), 'cases directory must contain only accepted case JSON files, no links');
  const { parseDevCase } = await import('../dist/dev-artifacts.js');
  const cases = [], artifacts = new Map(), groups = new Map();
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const bytes = await boundedRead(path.join(directory, entry.name), 256 * 1024);
    const artifact = parseDevCase(bytes.toString('utf8'));
    assert.equal(entry.name, `${artifact.caseId}.json`, 'accepted case filename disagrees with identity');
    const callable = `${artifact.locator.module}#${artifact.locator.namePath.join('.')}`;
    groups.set(callable, (groups.get(callable) ?? 0) + 1);
    cases.push({ caseId: artifact.caseId, artifactSha256: sha256(bytes), callable, environment: artifact.environment });
    artifacts.set(artifact.caseId, bytes.toString('utf8'));
  }
  assert.equal(cases.length, pilot.counts.accepted, 'case directory count disagrees with accepted pilot count');
  assert.deepEqual([...groups].sort(), pilot.mutation.callables.map(entry => [entry.callable, entry.cases]).sort(), 'accepted callables disagree with mutation pilot');
  const pin = PILOTS.find(item => item.id === pilot.id);
  const session = validateHumanReviewSession({ schemaVersion: 1, artifactKind: 'human-review-session', pilotId: pin.id, repository: pin.repository, revision: pin.revision, pilotReportSha256: sha256(reportBytes), tarballSha256, cases });
  return { session, artifacts, directory };
}
async function outputPath(settings, directory) {
  assert.ok(settings['--output'], '--output is required');
  const output = path.resolve(settings['--output']);
  const physical = path.join(await realpath(path.dirname(output)), path.basename(output));
  assert.ok(!within(directory, physical), 'output must be outside accepted cases');
  for (const flag of ['--pilot-report', '--tarball', '--session']) if (settings[flag]) assert.notEqual(physical, await realpath(settings[flag]), 'output must not overwrite an input');
  return physical;
}
const document = value => JSON.stringify(value, null, 2) + '\n';

async function main() {
  const settings = options(process.argv.slice(2));
  if (settings['--help']) { console.log(usage); return; }
  assert.match(process.versions.node, /^22\./, 'human pilot workflow requires Node 22');
  assert.equal(['--prepare', '--review', '--validate'].filter(flag => settings[flag]).length, 1, 'choose exactly one of --prepare, --review or --validate');
  const allowed = new Set(['--pilot-report', '--tarball', '--cases', settings['--prepare'] ? '--prepare' : settings['--review'] ? '--review' : '--validate']);
  for (const flag of settings['--prepare'] ? ['--output'] : settings['--review'] ? ['--session', '--participant', '--ceiling-ms', '--output'] : ['--session']) allowed.add(flag);
  assert.ok(Object.keys(settings).every(flag => allowed.has(flag)), 'option is not supported in this mode');
  if (settings['--review']) assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'human review requires an interactive TTY; piped input cannot measure a human');
  const { session, artifacts, directory } = await provenance(settings);
  if (settings['--prepare']) {
    await writeFile(await outputPath(settings, directory), document(session), { flag: 'wx' });
    console.log(`HUMAN REVIEW SESSION PREPARED (${session.cases.length} accepted cases; timing unmeasured)`); return;
  }
  assert.ok(settings['--session'], '--session is required');
  assert.deepEqual(validateHumanReviewSession(await json(settings['--session'])), session, 'session provenance changed; prepare a new session');
  if (settings['--validate']) {
    const report = validateHumanReviewReport(await json(settings['--validate']), session);
    console.log(`HUMAN REVIEW EVIDENCE VALIDATED (${report.ceilingExceeded ? 'ceiling exceeded; bring evidence to user' : 'within user ceiling'})`); return;
  }
  const ceilingMs = Number(settings['--ceiling-ms']);
  assert.ok(settings['--participant']?.trim() && settings['--participant'].length <= 1000 && !/[\u0000-\u001f\u007f]/.test(settings['--participant']) && Number.isFinite(ceilingMs) && ceilingMs > 0, '--participant and a positive --ceiling-ms chosen by the user are required');
  const output = await outputPath(settings, directory);
  // Reserve before collecting any timing so an existing report is never replaced.
  const reserved = await open(output, 'wx');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  const abort = () => controller.abort();
  terminal.once('SIGINT', abort); terminal.once('close', abort); process.once('SIGTERM', abort); process.once('SIGINT', abort);
  const question = prompt => terminal.question(prompt, { signal: controller.signal });
  const report = { schemaVersion: 1, artifactKind: 'human-review-evidence', sessionSha256: sessionDigest(session), session, reviewMode: 'terminal-interactive', clock: 'performance.now', participant: { id: settings['--participant'], role: 'user' }, ceilingMs, measurements: [], totalReviewMs: 0, ceilingExceeded: false };
  let completed = false;
  try {
    assert.equal(await question('The participant must be the user. Type user to confirm you are personally reviewing: '), 'user', 'user participation was not confirmed');
    assert.equal(await question(`Type ${ceilingMs} to set your per-case ceiling in milliseconds: `), String(ceilingMs), 'user ceiling was not confirmed');
    for (const entry of session.cases) {
      await question(`Case ${report.measurements.length + 1}/${session.cases.length}: press Enter when ready. Timing starts when the artifact appears. `);
      const startedAt = new Date().toISOString(), start = performance.now();
      // JSON encoding escapes terminal control characters in artifact string values.
      console.log(document(JSON.parse(artifacts.get(entry.caseId))));
      let answer;
      do { answer = (await question('Review the callable, arguments, trace and completion. Type accept or reject: ')).trim(); } while (!['accept', 'reject'].includes(answer));
      const reviewMs = performance.now() - start, finishedAt = new Date().toISOString();
      const note = await question('Optional review note (outside timing): ');
      report.measurements.push({ caseId: entry.caseId, startedAt, finishedAt, reviewMs, decision: answer, note });
    }
    report.totalReviewMs = report.measurements.reduce((sum, entry) => sum + entry.reviewMs, 0);
    report.ceilingExceeded = report.measurements.some(entry => entry.reviewMs > ceilingMs);
    // Re-read the actual artifacts after the session to reject concurrent drift.
    controller.signal.throwIfAborted();
    assert.deepEqual((await provenance(settings)).session, session, 'pilot inputs changed during review');
    controller.signal.throwIfAborted();
    validateHumanReviewReport(report, session);
    controller.signal.throwIfAborted();
    await reserved.writeFile(document(report));
    controller.signal.throwIfAborted(); completed = true;
    console.log(`HUMAN REVIEW EVIDENCE RECORDED (${report.ceilingExceeded ? 'ceiling exceeded; bring evidence to user' : 'within user ceiling'})`);
  } finally {
    process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort); terminal.close(); await reserved.close();
    if (!completed) await unlink(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
