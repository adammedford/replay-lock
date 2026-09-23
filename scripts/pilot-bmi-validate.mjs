import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(process.argv[2]);
const output = path.resolve(process.argv[3]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(await readFile(path.join(root, 'package.json'))), 'c7c895e812ffa46c06d65766e01e82397fbcac48bc35f28f1f4230804b397198');
assert.equal(sha256(await readFile(path.join(root, 'package-lock.json'))), '88da2115c10d3147f76e603ab25660382103543b24d5a68201d92721570488b5');
const cli = path.join(root, 'node_modules/replaylock/dist/cli.js');
const guard = fileURLToPath(new URL('./pilot-offline-guard.mjs', import.meta.url));
const source = path.join(root, 'src/utils/bmiCalculator.ts');
const original = await readFile(source, 'utf8');
const cases = await Promise.all((await readdir(path.join(root, '.replaylock/cases'))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(root, '.replaylock/cases', name), 'utf8'))));
// calculateBMI became capturable with the P1-P6 analyzer changes.
assert.deepEqual(cases.map(item => item.locator.namePath.at(-1)).sort(), ['calculateBMI', 'getBMICategory', 'getHealthSuggestions']);
assert.ok(cases.every(item => item.environment === 'browser' && item.trace.length === 0));
assert.ok(cases.every(item => item.arguments.kind === 'array' && item.eligibility.verdict === 'replayable'));

function verify() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'verify'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: `--import=${guard}`, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH } });
    let transcript = '';
    child.stdout.on('data', data => { transcript += data; });
    child.stderr.on('data', data => { transcript += data; });
    child.on('close', code => resolve({ exitCode: code, verifiedAll: transcript.includes(`Verified ${cases.length} V2 case(s)`), outputMismatch: /OUTPUT_MISMATCH/.test(transcript), outputTail: transcript.slice(-1000) }));
  });
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))), guardSha256: sha256(await readFile(guard)), cases: cases.map(item => ({ caseId: item.caseId, locator: item.locator, environment: item.environment, input: item.arguments, trace: item.trace, completion: item.completion })), originalSourceSha256: sha256(original) };
try {
  report.offlineReplay = await verify();
  assert.equal(report.offlineReplay.exitCode, 0);
  assert.equal(report.offlineReplay.verifiedAll, true);
  await writeFile(source, '// Behavior-preserving pilot comment\n' + original);
  report.benignEditReplay = await verify();
  assert.equal(report.benignEditReplay.exitCode, 0);
  assert.equal(report.benignEditReplay.verifiedAll, true);
  assert.ok(original.includes('if (bmi < 24.9)'));
  await writeFile(source, original.replace('if (bmi < 24.9)', 'if (bmi < 24.0)'));
  report.seededRegression = await verify();
  assert.equal(report.seededRegression.exitCode, 1);
  assert.equal(report.seededRegression.outputMismatch, true);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message ?? error);
} finally {
  await writeFile(source, original);
  report.restoredSourceSha256 = sha256(await readFile(source));
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
assert.equal(report.status, 'passed', JSON.stringify(report));
console.log(JSON.stringify({ status: report.status, offlineReplay: report.offlineReplay.exitCode, benignEditReplay: report.benignEditReplay.exitCode, seededRegression: report.seededRegression.exitCode, restored: report.restoredSourceSha256 === report.originalSourceSha256 }));
