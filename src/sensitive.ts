/**
 * The single source of truth for the privacy heuristics shared by the V1
 * runtime safety scanner (`observation-safety.ts`) and the V2 development value
 * codec (`dev-values.ts`).
 *
 * Both paths once carried their own copies and drifted apart: the V1 key check
 * was an exact-match set where V2's was a substring match, so an ordinary key
 * such as `dbPassword` was blocked by one capture path and persisted verbatim
 * by the other. The value scanners had diverged the same way -- only V2 caught
 * inline `key=value` secret assignments, URL basic-auth credentials, and
 * embedded JWTs. Both now go through this module so the two paths cannot drift
 * again.
 *
 * This module is intentionally dependency-free (no Node built-ins) so it is
 * equally safe in the browser bundle and in Node. These are conservative
 * defense-in-depth heuristics, never a guarantee: a human must still inspect
 * every displayed value before it is committed.
 */

/** Substring vocabulary for a secret-shaped property name. */
const SECRET_KEY_PATTERN =
  /(?:password|passwd|passphrase|secret|apikey|accesstoken|refreshtoken|authorization|cookie|privatekey|credential)/i;

/** Value shapes that betray a credential regardless of the surrounding key. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // Known credential token formats.
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|gh[pousr]_|github_pat_|\bsk-|sk_live_|rk_live_|xox[bpars]-|\b(?:basic|bearer)\s+\S+/i,
  // An inline `secret = value` / `secret: value` assignment inside a string.
  /(?:password|passwd|passphrase|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|private[_ -]?key)["']?\s*[:=]\s*["']?[^\s"'&,}]+/i,
  // URL basic-auth credentials (`https://user:pass@host`).
  /https?:\/\/[^/\s]+:[^/\s]+@/i,
  // An embedded JWT: both the header and payload segments are base64url of `{`.
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];

/** Strip punctuation/case so `API-Key`, `api_key`, and `apiKey` compare alike. */
export function normalizeSecretKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en-US");
}

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(normalizeSecretKey(key));
}

export function isSensitiveString(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}
