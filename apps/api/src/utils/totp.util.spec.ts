import {
  generateTotpSecret,
  verifyTotp,
  generateOtpAuthUrl,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from './totp.util';
import { authenticator } from '@otplib/preset-default';

describe('totp.util', () => {
  describe('generateTotpSecret()', () => {
    it('should return a non-empty base32 string', () => {
      const secret = generateTotpSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
      // Base32 characters only
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    });

    it('should generate unique secrets on each call', () => {
      const s1 = generateTotpSecret();
      const s2 = generateTotpSecret();
      expect(s1).not.toEqual(s2);
    });
  });

  describe('verifyTotp()', () => {
    it('should verify a valid TOTP token', () => {
      const secret = generateTotpSecret();
      const token = authenticator.generate(secret);
      expect(verifyTotp(token, secret)).toBe(true);
    });

    it('should reject an invalid TOTP token', () => {
      const secret = generateTotpSecret();
      expect(verifyTotp('000000', secret)).toBe(false);
    });

    it('should return false for garbage input', () => {
      expect(verifyTotp('not-a-code', 'not-a-secret')).toBe(false);
    });
  });

  describe('generateOtpAuthUrl()', () => {
    it('should return an otpauth:// URL with BESTCHOICE issuer', () => {
      const secret = generateTotpSecret();
      const url = generateOtpAuthUrl({ secret, label: 'test@example.com' });
      expect(url).toMatch(/^otpauth:\/\/totp\//);
      expect(url).toContain('issuer=BESTCHOICE');
      expect(url).toContain(`secret=${secret}`);
    });

    it('should encode the label in the URL', () => {
      const secret = generateTotpSecret();
      const url = generateOtpAuthUrl({ secret, label: 'user@test.com' });
      expect(url).toContain('user');
    });
  });

  describe('generateBackupCodes()', () => {
    it('should return 10 codes by default', () => {
      const codes = generateBackupCodes();
      expect(codes).toHaveLength(10);
    });

    it('should return the requested count of codes', () => {
      const codes = generateBackupCodes(5);
      expect(codes).toHaveLength(5);
    });

    it('each code should be 8 uppercase hex characters', () => {
      const codes = generateBackupCodes(10);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{8}$/);
      }
    });

    it('should generate unique codes', () => {
      const codes = generateBackupCodes(10);
      const unique = new Set(codes);
      expect(unique.size).toBe(10);
    });
  });

  describe('hashBackupCode() + verifyBackupCode()', () => {
    it('should hash and verify a backup code successfully', async () => {
      const code = 'ABCD1234';
      const stored = await hashBackupCode(code);
      expect(stored).toContain(':');
      const result = await verifyBackupCode(code, stored);
      expect(result).toBe(true);
    });

    it('should reject an incorrect code against a stored hash', async () => {
      const code = 'ABCD1234';
      const stored = await hashBackupCode(code);
      const result = await verifyBackupCode('WRONGABC', stored);
      expect(result).toBe(false);
    });

    it('should return false for malformed stored value', async () => {
      const result = await verifyBackupCode('ABCD1234', 'not-a-valid-hash');
      expect(result).toBe(false);
    });
  });
});
