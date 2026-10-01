import assert from 'node:assert/strict';
import { PILOTS, sha256 } from './pilot-dev-manifest.mjs';

const epic = PILOTS.find(pilot => pilot.id === 'epic-stack');
const keys = (value, expected, label) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} missing or unknown fields`);
};
const digest = (value, label) => assert.match(value ?? '', /^[a-f0-9]{64}$/, `${label} must be SHA256`);
const text = (value, label, empty = false) => assert.ok(typeof value === 'string' && value.length <= 1000 && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value), `${label} must be bounded text`);
const positive = (value, label) => assert.ok(Number.isFinite(value) && value > 0, `${label} must be a positive number`);
const timestamp = value => {
  assert.ok(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'invalid measurement timestamp');
  return Date.parse(value);
};

/** A session contains identities and byte digests, never invented review times. */
export function validateHumanReviewSession(session) {
  keys(session, ['schemaVersion', 'artifactKind', 'pilotId', 'repository', 'revision', 'pilotReportSha256', 'tarballSha256', 'cases'], 'session');
  assert.equal(session.schemaVersion, 1, 'unsupported human session schema');
  assert.equal(session.artifactKind, 'human-review-session', 'wrong session artifact kind');
  for (const key of ['pilotId', 'repository', 'revision']) assert.equal(session[key], key === 'pilotId' ? epic.id : epic[key], `session ${key} drift`);
  digest(session.pilotReportSha256, 'pilot report digest'); digest(session.tarballSha256, 'tarball digest');
  assert.ok(Array.isArray(session.cases) && session.cases.length > 0, 'session needs accepted cases');
  const ids = new Set();
  for (const entry of session.cases) {
    keys(entry, ['caseId', 'artifactSha256', 'callable', 'environment'], 'accepted case');
    digest(entry.caseId, 'case ID'); digest(entry.artifactSha256, 'artifact digest');
    assert.ok(!ids.has(entry.caseId), 'duplicate accepted case'); ids.add(entry.caseId);
    text(entry.callable, 'callable'); assert.ok(['node', 'browser'].includes(entry.environment), 'invalid case environment');
  }
  assert.deepEqual(session.cases.map(entry => entry.caseId), [...ids].sort(), 'cases must be sorted by ID');
  return session;
}

export const sessionDigest = session => sha256(JSON.stringify(validateHumanReviewSession(session), (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value));

/** Validate against a session independently rebuilt from actual pilot inputs. */
export function validateHumanReviewReport(report, trustedSession) {
  validateHumanReviewSession(trustedSession);
  keys(report, ['schemaVersion', 'artifactKind', 'sessionSha256', 'session', 'reviewMode', 'clock', 'participant', 'ceilingMs', 'measurements', 'totalReviewMs', 'ceilingExceeded'], 'human report');
  assert.equal(report.schemaVersion, 1, 'unsupported human evidence schema');
  assert.equal(report.artifactKind, 'human-review-evidence', 'wrong human artifact kind');
  validateHumanReviewSession(report.session);
  assert.deepEqual(report.session, trustedSession, 'human evidence provenance disagrees with pilot inputs');
  digest(report.sessionSha256, 'session digest'); assert.equal(report.sessionSha256, sessionDigest(trustedSession), 'session digest mismatch');
  assert.equal(report.reviewMode, 'terminal-interactive', 'scripted review cannot supply human timing');
  assert.equal(report.clock, 'performance.now', 'human timing must use the monotonic clock');
  keys(report.participant, ['id', 'role'], 'participant'); text(report.participant.id, 'participant');
  assert.equal(report.participant.role, 'user', 'the participant must be the user');
  positive(report.ceilingMs, 'user-set ceilingMs');
  assert.ok(Array.isArray(report.measurements), 'missing measurements');
  assert.equal(report.measurements.length, trustedSession.cases.length, 'every accepted case needs a measurement');
  let total = 0, previousEnd = -Infinity;
  const seen = new Set();
  for (const entry of report.measurements) {
    keys(entry, ['caseId', 'startedAt', 'finishedAt', 'reviewMs', 'decision', 'note'], 'measurement');
    assert.ok(trustedSession.cases.some(item => item.caseId === entry.caseId) && !seen.has(entry.caseId), 'unknown or duplicate measured case'); seen.add(entry.caseId);
    const start = timestamp(entry.startedAt), end = timestamp(entry.finishedAt);
    assert.ok(start >= previousEnd && end >= start, 'overlapping or reversed human timing'); previousEnd = end;
    positive(entry.reviewMs, 'reviewMs');
    // Date timestamps are millisecond precision; elapsed time comes from a monotonic clock.
    assert.ok(Math.abs(end - start - entry.reviewMs) <= 1000, 'timing clocks disagree');
    assert.ok(['accept', 'reject'].includes(entry.decision), 'missing human review decision'); text(entry.note, 'note', true);
    total += entry.reviewMs;
  }
  positive(total, 'totalReviewMs');
  assert.equal(report.totalReviewMs, total, 'totalReviewMs disagrees with per-case timings');
  assert.equal(report.ceilingExceeded, report.measurements.some(entry => entry.reviewMs > report.ceilingMs), 'ceiling result disagrees with measured cases');
  return report;
}
