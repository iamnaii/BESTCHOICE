import { BadRequestException } from '@nestjs/common';
import { CustomerPiiService } from './customer-pii.service';
import type { PrismaService } from '../../prisma/prisma.service';

// Test PII secrets — 64 hex chars (32 bytes) for AES-256, 32+ chars for salt.
const TEST_KEY = 'a'.repeat(64);
const TEST_SALT = 'b'.repeat(48);

function makePrismaMock(systemConfigValue?: string | null) {
  return {
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(
        systemConfigValue !== undefined ? { value: systemConfigValue } : null,
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

describe('CustomerPiiService', () => {
  let originalKey: string | undefined;
  let originalSalt: string | undefined;
  let originalStrict: string | undefined;

  beforeEach(() => {
    originalKey = process.env.PII_ENCRYPTION_KEY;
    originalSalt = process.env.PII_HASH_SALT;
    originalStrict = process.env.PDPA_STRICT_MODE;
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
    process.env.PII_HASH_SALT = TEST_SALT;
    delete process.env.PDPA_STRICT_MODE;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = originalKey;
    if (originalSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = originalSalt;
    if (originalStrict === undefined) delete process.env.PDPA_STRICT_MODE;
    else process.env.PDPA_STRICT_MODE = originalStrict;
  });

  describe('encryptCustomerFields', () => {
    it('produces *Encrypted + *Hash columns for nationalId and phone', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const out = svc.encryptCustomerFields({
        nationalId: '1234567890123',
        phone: '0812345678',
      });
      expect(out.nationalIdEncrypted).toMatch(/^[a-f0-9]{32}:/);
      expect(out.nationalIdHash).toMatch(/^[a-f0-9]{64}$/);
      expect(out.phoneEncrypted).toMatch(/^[a-f0-9]{32}:/);
      expect(out.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('leaves undefined fields untouched (partial-update safe)', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const out = svc.encryptCustomerFields({ phone: '0812345678' });
      expect('nationalIdEncrypted' in out).toBe(false);
      expect('nationalIdHash' in out).toBe(false);
      expect(out.phoneEncrypted).toBeDefined();
    });

    it('passes through null / empty without encrypting', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const out = svc.encryptCustomerFields({
        nationalId: null,
        phone: '',
      });
      expect(out.nationalIdEncrypted).toBeNull();
      expect(out.nationalIdHash).toBeNull();
      expect(out.phoneEncrypted).toBe('');
      expect(out.phoneHash).toBe('');
    });

    it('produces deterministic hashes (same input → same hash)', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const a = svc.encryptCustomerFields({ phone: '0812345678' });
      const b = svc.encryptCustomerFields({ phone: '0812345678' });
      // hashes must match for unique-constraint based lookup to work
      expect(a.phoneHash).toBe(b.phoneHash);
      // ciphertexts must differ (IV randomness — same plaintext → different ciphertext)
      expect(a.phoneEncrypted).not.toBe(b.phoneEncrypted);
    });

    it('passes through plaintext when PII_ENCRYPTION_KEY missing (dev fallback)', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      const svc = new CustomerPiiService(makePrismaMock());
      const out = svc.encryptCustomerFields({ phone: '0812345678' });
      expect(out.phoneEncrypted).toBe('0812345678');
    });
  });

  describe('decryptCustomerFields', () => {
    it('round-trips a record through encrypt then decrypt', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const enc = svc.encryptCustomerFields({
        nationalId: '1234567890123',
        phone: '0812345678',
        email: 'alice@example.com',
      });
      const row = {
        id: 'c1',
        nationalIdEncrypted: enc.nationalIdEncrypted!,
        phoneEncrypted: enc.phoneEncrypted!,
        emailEncrypted: enc.emailEncrypted!,
      } as Record<string, unknown>;

      const dec = svc.decryptCustomerFields(row)!;
      expect(dec.nationalId).toBe('1234567890123');
      expect(dec.phone).toBe('0812345678');
      expect(dec.email).toBe('alice@example.com');
    });

    it('falls back to legacy plaintext column when encrypted is null (non-strict)', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const dec = svc.decryptCustomerFields({
        id: 'c1',
        nationalId: '9999999999999',
        nationalIdEncrypted: null,
      })!;
      expect(dec.nationalId).toBe('9999999999999');
    });

    it('throws BadRequestException in strict mode if encrypted is null but plaintext present', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(() =>
        svc.decryptCustomerFields(
          {
            id: 'c1',
            nationalId: '9999999999999',
            nationalIdEncrypted: null,
          },
          { strict: true },
        ),
      ).toThrow(BadRequestException);
    });

    it('returns the input unchanged when row is null', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.decryptCustomerFields(null)).toBeNull();
    });
  });

  describe('searchByHash', () => {
    it('returns { phoneHash } for phone field', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const where = svc.searchByHash('phone', '0812345678');
      expect(where).toEqual({ phoneHash: expect.any(String) });
      expect(where!.phoneHash).toHaveLength(64);
    });

    it('returns { nationalIdHash } for nationalId field', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      const where = svc.searchByHash('nationalId', '1234567890123');
      expect(where).toEqual({ nationalIdHash: expect.any(String) });
    });

    it('returns null for email (not hash-searchable)', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.searchByHash('email', 'a@b.com')).toBeNull();
    });

    it('returns null when value is empty', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.searchByHash('phone', '')).toBeNull();
    });

    it('returns null when salt is unconfigured', () => {
      delete process.env.PII_HASH_SALT;
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.searchByHash('phone', '0812345678')).toBeNull();
    });
  });

  describe('isStrictMode', () => {
    it('returns true when SystemConfig PDPA_STRICT_MODE=true', async () => {
      const svc = new CustomerPiiService(makePrismaMock('true'));
      await expect(svc.isStrictMode()).resolves.toBe(true);
    });

    it('returns false when SystemConfig is unset and env var unset', async () => {
      const svc = new CustomerPiiService(makePrismaMock(null));
      await expect(svc.isStrictMode()).resolves.toBe(false);
    });

    it('falls back to PDPA_STRICT_MODE env var when SystemConfig is missing', async () => {
      process.env.PDPA_STRICT_MODE = '1';
      const svc = new CustomerPiiService(makePrismaMock(null));
      await expect(svc.isStrictMode()).resolves.toBe(true);
    });

    it('caches results within the TTL window', async () => {
      const prisma = makePrismaMock('true') as unknown as { systemConfig: { findFirst: jest.Mock } };
      const svc = new CustomerPiiService(prisma as unknown as PrismaService);
      await svc.isStrictMode();
      await svc.isStrictMode();
      await svc.isStrictMode();
      // Three calls but only one DB query thanks to cache.
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(1);
    });

    it('invalidateStrictModeCache() forces a re-read', async () => {
      const prisma = makePrismaMock('true') as unknown as { systemConfig: { findFirst: jest.Mock } };
      const svc = new CustomerPiiService(prisma as unknown as PrismaService);
      await svc.isStrictMode();
      svc.invalidateStrictModeCache();
      await svc.isStrictMode();
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('setStrictMode', () => {
    it('upserts the SystemConfig row and clears the cache', async () => {
      const prisma = makePrismaMock(null);
      const svc = new CustomerPiiService(prisma);
      await svc.setStrictMode(true);
      // upsert called
      expect(
        (prisma as unknown as { systemConfig: { upsert: jest.Mock } }).systemConfig.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'PDPA_STRICT_MODE' },
          create: expect.objectContaining({ key: 'PDPA_STRICT_MODE', value: 'true' }),
        }),
      );
    });
  });

  describe('hash', () => {
    it('produces a 64-char hex hash for a non-empty string', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.hash('0812345678')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns null for empty / null inputs', () => {
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.hash(null)).toBeNull();
      expect(svc.hash('')).toBeNull();
      expect(svc.hash(undefined)).toBeNull();
    });

    it('returns null when salt is unconfigured', () => {
      delete process.env.PII_HASH_SALT;
      const svc = new CustomerPiiService(makePrismaMock());
      expect(svc.hash('x')).toBeNull();
    });
  });
});
