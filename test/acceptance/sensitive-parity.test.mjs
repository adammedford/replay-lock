import assert from "node:assert/strict";
import test from "node:test";

import { isSensitiveKey, isSensitiveString } from "../../dist/sensitive.js";
import { encodeDevValue } from "../../dist/dev-values.js";

// dev-values.js is a realm-portable leaf module and cannot import sensitive.js,
// so it carries its own byte-identical copy of these heuristics. This test is
// the guard that they never drift: the V1 runtime scanner and the V2 codec must
// reach the same sensitive/not-sensitive verdict for every case, which is the
// exact defect (dbPassword blocked by one path, persisted by the other) that
// motivated the shared definition.
function devKeySensitive(key) {
  try { encodeDevValue({ [key]: 1 }); return false; }
  catch (error) { return error.code === "SENSITIVE_VALUE"; }
}
function devStringSensitive(value) {
  try { encodeDevValue(value); return false; }
  catch (error) { return error.code === "SENSITIVE_VALUE"; }
}

test("V1 and V2 agree on sensitive property names", () => {
  for (const key of [
    "password", "dbPassword", "userPassword", "API-Key", "apiKeyValue", "api_key",
    "secret", "clientSecret", "user_secret", "accessToken", "refresh_token",
    "authorization", "authHeader", "cookie", "sessionCookie", "privateKey",
    "privateKeyPem", "credential", "credentials",
    // Ordinary keys that must stay allowed.
    "count", "dbHost", "userId", "total", "githubToken", "name",
  ]) {
    assert.equal(isSensitiveKey(key), devKeySensitive(key), `key: ${key}`);
  }
});

test("V1 and V2 agree on credential-shaped values", () => {
  for (const value of [
    "-----BEGIN PRIVATE KEY-----", "AKIA1234567890ABCDEF", "ghp_1234567890",
    "github_pat_123", "sk-1234567890", "sk_live_123", "rk_live_123", "xoxb-123",
    "Basic abc", "Bearer abc", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature",
    "note password: hunter2", "https://user:pw@example.test",
    "prefix eyJhbGciOiJ.eyJzdWIiOiIx.sig",
    // Near misses and ordinary values that must stay allowed.
    "AKIA123", "ghz_123456", "skx-123456", "Bearer",
    "eyJhbGciOiJub25lIn0.not-json.signature", "ordinary text", "localhost:5173",
  ]) {
    assert.equal(isSensitiveString(value), devStringSensitive(value), `value: ${value}`);
  }
});
