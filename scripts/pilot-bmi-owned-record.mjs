import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const root = await realpath(process.argv[2]);
const output = path.resolve(process.argv[3]);
const port = Number(process.argv[4] ?? 43187);
assert.ok(process.argv[5], 'pass the packed ReplayLock tarball as the fourth argument');
const tarball = path.resolve(process.argv[5]);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
assert.equal(sha256(await readFile(path.join(root, 'package.json'))), 'c7c895e812ffa46c06d65766e01e82397fbcac48bc35f28f1f4230804b397198');
assert.equal(sha256(await readFile(path.join(root, 'package-lock.json'))), '88da2115c10d3147f76e603ab25660382103543b24d5a68201d92721570488b5');
assert.equal(sha256(await readFile(path.join(root, 'src/utils/bmiCalculator.ts'))), 'cdd2a2fe9f22917fdedca7accf1ac7a5b7f33e4b783379241dcf57491011ab30');
assert.equal(sha256(await readFile(path.join(root, 'src/utils/healthSuggestions.ts'))), '61bafddda74588f8823d2e955eed6282134c8c0528d680e0b0c8067c58abd8ed');

async function listenerOpen() {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}
async function discover() {
  try {
    for (const name of await readdir(path.join(root, '.replaylock/dev'))) {
      if (!name.endsWith('.json')) continue;
      const manifest = JSON.parse(await readFile(path.join(root, '.replaylock/dev', name), 'utf8'));
      if (new URL(manifest.url).port === String(port) && manifest.launch) return manifest;
    }
  } catch {}
}
function runBrowser(url) {
  return new Promise((resolve, reject) => {
    const browserScript = fileURLToPath(new URL('./pilot-bmi-browser.mjs', import.meta.url));
    const child = spawn(process.execPath, [browserScript, url], { cwd: path.dirname(browserScript), stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
    child.stdout.on('data', data => { text += data; });
    child.stderr.on('data', data => { text += data; });
    child.on('close', code => { clearTimeout(timer); return !timedOut && code === 0 ? resolve(JSON.parse(text.trim())) : reject(Error(`BROWSER_WORKFLOW_FAILED: ${timedOut ? 'TIMEOUT' : text.slice(-1000)}`)); });
  });
}

const cli = path.join(root, 'node_modules/replaylock/dist/cli.js');
const child = spawn(process.execPath, [cli, 'record', '--', 'npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
});
let transcript = '', exited = false, closed = false, exitCode = null, manifest, stopped;
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRevision: '5b32cf94ed51ab00c43a2d98ffb410270bbeebd4',
  source: { packageJsonSha256: sha256(await readFile(path.join(root, 'package.json'))), lockfileSha256: sha256(await readFile(path.join(root, 'package-lock.json'))) },
  artifact: { tarballSha256: sha256(await readFile(tarball)), installedDevServerSha256: sha256(await readFile(path.join(root, 'node_modules/replaylock/dist/dev-server.js'))) },
  environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
  runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))), workflowRunnerSha256: sha256(await readFile(fileURLToPath(new URL('./pilot-bmi-browser.mjs', import.meta.url)))) };
child.stdout.on('data', data => { transcript += data; });
child.stderr.on('data', data => { transcript += data; });
child.on('exit', code => { exited = true; exitCode = code; });
child.on('close', () => { closed = true; });
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !exited) {
    manifest = await discover();
    if (manifest && transcript.includes(`ReplayLock attached to ${manifest.url}`)) break;
    await pause(100);
  }
  assert.ok(manifest && !exited, 'PLUGIN_NOT_ACTIVE');
  report.workflow = await runBrowser(manifest.url);
  const response = await fetch(`${manifest.url}__replaylock/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ReplayLock-Token': manifest.token }, body: '{}', signal: AbortSignal.timeout(20000) });
  stopped = await response.json();
  assert.equal(response.status, 200, stopped.code);
  report.recording = { observations: stopped.observations, candidates: stopped.candidates, recordingBlocks: stopped.recordingBlocks, session: stopped.session };
  assert.ok(stopped.candidates >= 1, 'NO_WORKFLOW_CANDIDATES');
} catch (error) {
  report.error = String(error.message ?? error);
} finally {
  for (let n = 0; n < 200 && !exited; n++) await pause(100);
  let signaledByProbe = false;
  if (!exited) {
    signaledByProbe = true;
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  for (let n = 0; n < 100 && !closed; n++) await pause(100);
  const discoveryRemoved = !(await discover());
  let ownedGroupExited = exited;
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 0); ownedGroupExited = false; } catch (error) { ownedGroupExited = error.code === 'ESRCH'; }
  }
  report.cleanup = { controllerExited: exited, outputPipesClosed: closed, ownedGroupExited, listenerClosed: !(await listenerOpen()), discoveryRemoved, signaledByProbe, controllerExitCode: exitCode };
  report.captureStatus = !stopped || stopped.recordingBlocks > 0 || exitCode !== 0 ? 'partial' : 'complete';
  report.status = !report.error && report.cleanup.controllerExited && report.cleanup.outputPipesClosed && ownedGroupExited && report.cleanup.listenerClosed && discoveryRemoved && !signaledByProbe ? 'passed' : 'failed';
  report.transcriptTail = transcript.slice(-2000);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
assert.equal(report.status, 'passed', JSON.stringify(report));
console.log(JSON.stringify({ status: report.status, recording: report.recording, cleanup: report.cleanup }));
