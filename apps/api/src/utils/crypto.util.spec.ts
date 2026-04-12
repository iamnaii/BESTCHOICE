import { encryptPII, decryptPII, isEncrypted } from './crypto.util';
import { randomBytes } from 'crypto';

describe('crypto.util', () => {
  // 32-byte hex key (256 bits)
  const key = randomBytes(32).toString('hex');

  describe('encryptPII / decryptPII', () => {
    it('should encrypt and decrypt correctly', () => {
      const plaintext = '1234567890123';
      const encrypted = encryptPII(plaintext, key);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':');
      const decrypted = decryptPII(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = '0812345678';
      const enc1 = encryptPII(plaintext, key);
      const enc2 = encryptPII(plaintext, key);
      expect(enc1).not.toBe(enc2);
      expect(decryptPII(enc1, key)).toBe(plaintext);
      expect(decryptPII(enc2, key)).toBe(plaintext);
    });

    it('should return plaintext when no key provided', () => {
      const plaintext = 'hello';
      expect(encryptPII(plaintext, '')).toBe(plaintext);
      expect(decryptPII(plaintext, '')).toBe(plaintext);
    });

    it('should handle empty string', () => {
      expect(encryptPII('', key)).toBe('');
      expect(decryptPII('', key)).toBe('');
    });

    it('should handle Thai text', () => {
      const thai = 'สวัสดีครับ';
      const encrypted = encryptPII(thai, key);
      expect(decryptPII(encrypted, key)).toBe(thai);
    });
  });

  describe('isEncrypted', () => {
    it('should detect encrypted values', () => {
      const encrypted = encryptPII('test', key);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should not flag plaintext', () => {
      expect(isEncrypted('1234567890123')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('hello world')).toBe(false);
    });
  });
});
