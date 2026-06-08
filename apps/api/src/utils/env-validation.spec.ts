import { validateEnv } from './env-validation';

describe('env-validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('production PII requirements', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://x';
      process.env.JWT_SECRET = 'x';
      process.env.JWT_REFRESH_SECRET = 'x';
      // ENCRYPTION_KEY required by validateTotpEncryptionEnv (>= 16 chars).
      // Set a valid one for tests that focus on PII checks.
      process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    });

    it('throws if PII_ENCRYPTION_KEY missing in prod', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      delete process.env.PII_HASH_SALT;
      expect(() => validateEnv()).toThrow(/PII_ENCRYPTION_KEY required/);
    });

    it('throws if PII_ENCRYPTION_KEY wrong length', () => {
      process.env.PII_ENCRYPTION_KEY = 'short';
      process.env.PII_HASH_SALT = 'a'.repeat(32);
      expect(() => validateEnv()).toThrow(/64 hex chars/);
    });

    it('throws if PII_ENCRYPTION_KEY not hex', () => {
      process.env.PII_ENCRYPTION_KEY = 'z'.repeat(64);
      process.env.PII_HASH_SALT = 'a'.repeat(32);
      expect(() => validateEnv()).toThrow(/64 hex chars/);
    });

    it('throws if PII_HASH_SALT missing in prod', () => {
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
      delete process.env.PII_HASH_SALT;
      expect(() => validateEnv()).toThrow(/PII_HASH_SALT required/);
    });

    it('throws if PII_HASH_SALT too short', () => {
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
      process.env.PII_HASH_SALT = 'short';
      expect(() => validateEnv()).toThrow(/>= 32 chars/);
    });

    it('passes when all required env vars valid', () => {
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
      process.env.PII_HASH_SALT = 'b'.repeat(32);
      expect(() => validateEnv()).not.toThrow();
    });

    // NOTE (2026-06): two tests asserting validateEnv() throws on a missing /
    // too-short ENCRYPTION_KEY in production were removed. That guard existed
    // only to protect the 2FA TOTP secret, which was deleted in #1169 (remove
    // staff-login 2FA). National-ID PII is guarded separately via
    // PII_ENCRYPTION_KEY + PII_HASH_SALT (covered above); ENCRYPTION_KEY is now
    // an unused legacy env var (ENV_VARS marks it required: false).
  });

  describe('development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://x';
      process.env.JWT_SECRET = 'x';
      process.env.JWT_REFRESH_SECRET = 'x';
    });

    it('does not require PII vars in dev', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      delete process.env.PII_HASH_SALT;
      expect(() => validateEnv()).not.toThrow();
    });
  });
});
