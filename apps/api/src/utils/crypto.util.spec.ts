import { encryptPII, decryptPII, isEncrypted } from './crypto.util';
import { randomBytes } from 'crypto';

describe('crypto.util (AES-256-GCM)', () => {
  // 32-byte hex key (256 bits) — AES-256 requires exactly this length.
  const key = randomBytes(32).toString('hex');

  describe('encryptPII / decryptPII', () => {
    it('round-trips a 13-digit Thai national ID', () => {
      const plaintext = '1234567890123';
      const encrypted = encryptPII(plaintext, key);
      expect(encrypted).not.toBe(plaintext);
      // Wire format: iv(24):authTag(32):ciphertext — 3 colon-separated parts.
      expect(encrypted.split(':').length).toBe(3);
      const decrypted = decryptPII(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = '0812345678';
      const enc1 = encryptPII(plaintext, key);
      const enc2 = encryptPII(plaintext, key);
      expect(enc1).not.toBe(enc2);
      expect(decryptPII(enc1, key)).toBe(plaintext);
      expect(decryptPII(enc2, key)).toBe(plaintext);
    });

    it('throws when key is missing or too short (no silent plaintext writes)', () => {
      // C2 — encryptPII MUST refuse misconfigured callers. The previous
      // passthrough behaviour wrote raw plaintext into the *_encrypted
      // column, which strict-mode `isEncrypted` was happy to accept.
      expect(() => encryptPII('hello', '')).toThrow(/missing or too short/i);
      expect(() => encryptPII('hello', 'too-short')).toThrow(/missing or too short/i);
    });

    it('decryptPII passes through input untouched when key absent (legacy plaintext column fallback)', () => {
      // Read-side keeps tolerant behaviour — strict-mode rejection
      // lives in CustomerPiiService.decryptCustomerFields, not here.
      expect(decryptPII('plain', '')).toBe('plain');
      expect(decryptPII('', '')).toBe('');
    });

    it('handles empty string round-trip', () => {
      expect(encryptPII('', key)).toBe('');
      expect(decryptPII('', key)).toBe('');
    });

    it('handles Thai text round-trip', () => {
      const thai = 'สวัสดีครับ';
      const encrypted = encryptPII(thai, key);
      expect(decryptPII(encrypted, key)).toBe(thai);
    });

    it('THROWS on tampered ciphertext (1-bit flip in ciphertext segment)', () => {
      // C1 — silent return-as-is would render `iv:tag:cipher` as the user's
      // phone number. GCM auth-tag verification MUST surface tampering.
      const encrypted = encryptPII('0812345678', key);
      const [iv, tag, cipherHex] = encrypted.split(':');
      // Flip the lowest bit of the last hex character of the ciphertext.
      const lastChar = cipherHex.slice(-1);
      const flipped = (parseInt(lastChar, 16) ^ 0x1).toString(16);
      const tampered = `${iv}:${tag}:${cipherHex.slice(0, -1)}${flipped}`;
      expect(() => decryptPII(tampered, key)).toThrow(/decryption failed/i);
    });

    it('THROWS on wrong key (decipher.final auth-tag mismatch)', () => {
      const encrypted = encryptPII('1234567890123', key);
      const wrongKey = randomBytes(32).toString('hex');
      expect(() => decryptPII(encrypted, wrongKey)).toThrow(/decryption failed/i);
    });

    it('THROWS on tampered auth tag', () => {
      const encrypted = encryptPII('1234567890123', key);
      const [iv, tag, cipherHex] = encrypted.split(':');
      const flippedTag = tag.slice(0, -1) + ((parseInt(tag.slice(-1), 16) ^ 0x1).toString(16));
      const tampered = `${iv}:${flippedTag}:${cipherHex}`;
      expect(() => decryptPII(tampered, key)).toThrow(/decryption failed/i);
    });

    it('error message NEVER leaks ciphertext or key material', () => {
      const encrypted = encryptPII('secret-pii', key);
      const wrongKey = randomBytes(32).toString('hex');
      try {
        decryptPII(encrypted, wrongKey);
        fail('expected throw');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain(encrypted);
        expect(msg).not.toContain(wrongKey);
        expect(msg).not.toContain('secret-pii');
      }
    });
  });

  describe('isEncrypted', () => {
    it('detects newly encrypted values (3-part GCM format)', () => {
      const encrypted = encryptPII('test', key);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('rejects plaintext', () => {
      expect(isEncrypted('1234567890123')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('hello world')).toBe(false);
    });

    it('rejects legacy CBC format (2 parts, 32-char IV) so legacy data falls back to plaintext column', () => {
      // CBC format would be `<iv-hex(32)>:<ciphertext-hex>` (2 parts).
      // GCM format requires 3 parts — CBC must NOT pass this check.
      const fakeCbc = 'a'.repeat(32) + ':' + 'b'.repeat(32);
      expect(isEncrypted(fakeCbc)).toBe(false);
    });

    it('rejects malformed inputs (wrong IV length, wrong tag length, non-hex)', () => {
      // Wrong IV length (should be 24 hex chars)
      expect(isEncrypted('aaaa:' + 'b'.repeat(32) + ':' + 'c'.repeat(8))).toBe(false);
      // Wrong tag length (should be 32 hex chars)
      expect(isEncrypted('a'.repeat(24) + ':bbb:' + 'c'.repeat(8))).toBe(false);
      // Non-hex chars
      expect(isEncrypted('x'.repeat(24) + ':' + 'b'.repeat(32) + ':' + 'c'.repeat(8))).toBe(false);
      // Empty ciphertext part
      expect(isEncrypted('a'.repeat(24) + ':' + 'b'.repeat(32) + ':')).toBe(false);
    });
  });
});
