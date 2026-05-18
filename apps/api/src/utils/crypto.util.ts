import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'crypto';

/**
 * Phase 3 SP4 — column-level PII encryption primitives.
 *
 * Algorithm: AES-256-GCM (authenticated encryption).
 *
 *   - 12-byte random IV per call (GCM standard — never reuse with the same key)
 *   - 16-byte auth tag emitted by `cipher.getAuthTag()` after `cipher.final()`
 *   - Wire format: `<iv-hex(24)>:<authTag-hex(32)>:<ciphertext-hex>`
 *
 * GCM is mandatory here (not CBC) because tamper detection is part of the
 * PDPA threat model. A wrong key OR a flipped bit MUST throw — never
 * silently leak garbage back as the customer's phone number.
 *
 * Migration note: a brief earlier draft of this util used AES-256-CBC with
 * the format `<iv-hex(32)>:<ciphertext-hex>`. The 3-part `isEncrypted`
 * format check distinguishes the two — any column that still holds CBC
 * data after this PR ships will fail `isEncrypted`, fall back to its
 * legacy plaintext column, and need to be re-encrypted by the next
 * backfill pass (Customer PII rolls through `pdpa-encryption.service`;
 * trade-in transferAccount* fields would need a one-off re-encrypt if
 * any production rows exist — see runbook §3).
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
/** Hex-encoded lengths of IV / auth tag — used by isEncrypted format check. */
const IV_HEX_LENGTH = IV_LENGTH_BYTES * 2; // 24
const AUTH_TAG_HEX_LENGTH = AUTH_TAG_LENGTH_BYTES * 2; // 32

/** Minimum acceptable key length (hex chars) — AES-256 needs 32 bytes = 64 hex. */
const MIN_KEY_HEX_LENGTH = 32;

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns the wire format `iv:authTag:ciphertext` (all hex).
 *
 * @throws Error when `key` is missing or shorter than 32 chars. We refuse
 *   to silently passthrough — see DEEP review C2 (a misconfigured prod
 *   would otherwise write literal plaintext to *_encrypted columns and
 *   strict-mode `isEncrypted` would happily accept it).
 *
 * Empty plaintext is returned as-is — encrypting '' would burn CPU + bytes
 * for nothing and the round-trip still produces ''.
 */
export function encryptPII(plaintext: string, key: string): string {
  if (!key || key.length < MIN_KEY_HEX_LENGTH) {
    throw new Error(
      'PII_ENCRYPTION_KEY missing or too short (need 32+ chars)',
    );
  }
  if (!plaintext) return plaintext;
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGO, Buffer.from(key, 'hex'), iv) as CipherGCM;
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a GCM-encrypted `iv:authTag:ciphertext` string back to plaintext.
 *
 * Returns the original input unchanged when:
 *   - input is empty, OR
 *   - input doesn't carry an `:` separator (clearly not our format —
 *     callers fall back to the legacy plaintext column path).
 *
 * @throws InternalServerErrorException equivalent (plain Error) when the
 *   input LOOKS like our wire format (3 parts, valid hex lengths) but
 *   `decipher.final()` rejects it — almost always a key mismatch or
 *   tampering attempt. We REFUSE to swallow this — silent return-as-is
 *   would render `iv:tag:ciphertext` as the user's national ID (DEEP
 *   review C1).
 */
export function decryptPII(ciphertext: string, key: string): string {
  if (!key || key.length < MIN_KEY_HEX_LENGTH) return ciphertext;
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  // Not our format → bail out untouched (legacy plaintext column passthrough).
  if (!isEncrypted(ciphertext)) return ciphertext;

  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGO, Buffer.from(key, 'hex'), iv) as DecipherGCM;
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encryptedHex, 'hex'),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // NEVER include the ciphertext or key in the error message — that
    // would leak the attack payload + key length into logs / Sentry.
    throw new Error(
      'PII decryption failed — possible key mismatch or tampering',
    );
  }
}

/**
 * Check if a value looks like a GCM-encrypted payload from this util.
 *
 * Format: `<iv-hex(24)>:<authTag-hex(32)>:<ciphertext-hex(>=2)>`
 *
 * Strict on lengths so a 13-digit national ID or an email address with `:`
 * in it never matches. CBC-format strings (2 parts, 32-char IV) also
 * fail this check — see migration note at top of file.
 */
export function isEncrypted(value: string): boolean {
  if (!value || !value.includes(':')) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivHex, authTagHex, encryptedHex] = parts;
  if (ivHex.length !== IV_HEX_LENGTH) return false;
  if (authTagHex.length !== AUTH_TAG_HEX_LENGTH) return false;
  if (encryptedHex.length < 2) return false;
  const HEX_RE = /^[0-9a-f]+$/i;
  return HEX_RE.test(ivHex) && HEX_RE.test(authTagHex) && HEX_RE.test(encryptedHex);
}
