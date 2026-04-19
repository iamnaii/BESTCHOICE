import { hashPII, maskNationalId, maskPhone, maskBankAccount, maskEmail } from './pii.util';

describe('pii.util', () => {
  const salt = 'test-salt-32-chars-minimum-needed-here';

  describe('hashPII', () => {
    it('returns deterministic hash for same input', () => {
      expect(hashPII('1234567890123', salt)).toBe(hashPII('1234567890123', salt));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashPII('1234567890123', salt)).not.toBe(hashPII('1234567890124', salt));
    });

    it('returns 64-char hex string', () => {
      const hash = hashPII('test', salt);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns empty string for empty input', () => {
      expect(hashPII('', salt)).toBe('');
    });

    it('throws if salt is missing or too short', () => {
      expect(() => hashPII('test', '')).toThrow('PII_HASH_SALT required');
      expect(() => hashPII('test', 'short')).toThrow('PII_HASH_SALT must be >= 32 chars');
    });
  });

  describe('maskNationalId', () => {
    it('shows 5 first + 1 last char', () => {
      expect(maskNationalId('1234567890123')).toBe('12345-XXXXX-XX-3');
    });

    it('returns empty for empty input', () => {
      expect(maskNationalId('')).toBe('');
    });

    it('returns input as-is if not 13 chars', () => {
      expect(maskNationalId('123')).toBe('123');
    });
  });

  describe('maskPhone', () => {
    it('shows prefix + last 2 chars', () => {
      expect(maskPhone('0812345678')).toBe('081-XXX-XX78');
    });

    it('returns input as-is if shorter than 10', () => {
      expect(maskPhone('12345')).toBe('12345');
    });
  });

  describe('maskBankAccount', () => {
    it('shows last 2 chars only', () => {
      expect(maskBankAccount('1234567890')).toBe('XXXXXXXX90');
    });

    it('returns empty for empty input', () => {
      expect(maskBankAccount('')).toBe('');
    });
  });

  describe('maskEmail', () => {
    it('masks local part except first char', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j*******@example.com');
    });

    it('returns input as-is if no @', () => {
      expect(maskEmail('not-an-email')).toBe('not-an-email');
    });
  });
});
