import {
  parseVatValue,
  loadVatRateDecimal,
  loadVatRatePercent,
  warnIfVatKeysCollide,
  DEFAULT_VAT_DECIMAL,
  DEFAULT_VAT_PERCENT,
} from './vat-rate.util';
import { Logger } from '@nestjs/common';

describe('vat-rate.util — D1.1.3.1 canonical key with legacy fallback', () => {
  describe('parseVatValue heuristic', () => {
    it('treats values >= 1 as percentage form ("7" → 0.07)', () => {
      expect(parseVatValue('7')).toBeCloseTo(0.07, 8);
      expect(parseVatValue('10')).toBeCloseTo(0.1, 8);
    });

    it('treats values < 1 as decimal form ("0.07" → 0.07)', () => {
      expect(parseVatValue('0.07')).toBeCloseTo(0.07, 8);
      expect(parseVatValue('0.10')).toBeCloseTo(0.1, 8);
    });

    it('returns null for malformed values', () => {
      expect(parseVatValue('abc')).toBeNull();
      expect(parseVatValue('')).toBeNull();
      expect(parseVatValue(null)).toBeNull();
      expect(parseVatValue(undefined)).toBeNull();
      expect(parseVatValue('-1')).toBeNull(); // negative
    });
  });

  describe('loadVatRateDecimal — canonical-key-first precedence', () => {
    const mkPrisma = (rows: { key: string; value: string }[]) => ({
      systemConfig: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    });

    it('returns VAT_RATE value when present (percentage form)', async () => {
      const prisma = mkPrisma([{ key: 'VAT_RATE', value: '7' }]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBeCloseTo(0.07, 8);
    });

    it('falls back to legacy vat_pct (decimal form) when VAT_RATE absent', async () => {
      const prisma = mkPrisma([{ key: 'vat_pct', value: '0.07' }]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBeCloseTo(0.07, 8);
    });

    it('falls back to legacy vat_pct percentage form too (data drift)', async () => {
      // If somehow vat_pct was saved as "7" (percent shape), the parser still
      // resolves it correctly via the >=1 → /100 heuristic.
      const prisma = mkPrisma([{ key: 'vat_pct', value: '7' }]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBeCloseTo(0.07, 8);
    });

    it('prefers VAT_RATE over vat_pct when BOTH present', async () => {
      // Realistic post-migration state — both keys live until orphan is cleaned.
      const prisma = mkPrisma([
        { key: 'VAT_RATE', value: '10' },        // new admin UI saved 10%
        { key: 'vat_pct', value: '0.07' },       // legacy seed value
      ]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBeCloseTo(0.1, 8); // VAT_RATE wins
    });

    it('defaults to 7% when no key is present', async () => {
      const prisma = mkPrisma([]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBe(DEFAULT_VAT_DECIMAL);
    });

    it('falls back to default when stored VAT_RATE is malformed', async () => {
      const prisma = mkPrisma([{ key: 'VAT_RATE', value: 'banana' }]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBe(DEFAULT_VAT_DECIMAL);
    });

    it('falls through to vat_rate when VAT_RATE+vat_pct both malformed', async () => {
      const prisma = mkPrisma([
        { key: 'VAT_RATE', value: '' },
        { key: 'vat_pct', value: 'NaN' },
        { key: 'vat_rate', value: '0.07' },
      ]);
      const result = await loadVatRateDecimal(prisma);
      expect(result).toBeCloseTo(0.07, 8);
    });
  });

  describe('loadVatRatePercent', () => {
    it('returns percent form (e.g. 7 for 7%)', async () => {
      const prisma = {
        systemConfig: { findMany: jest.fn().mockResolvedValue([{ key: 'VAT_RATE', value: '7' }]) },
      };
      const result = await loadVatRatePercent(prisma);
      expect(result).toBeCloseTo(7, 8);
    });

    it('defaults to 7 when no key set', async () => {
      const prisma = { systemConfig: { findMany: jest.fn().mockResolvedValue([]) } };
      const result = await loadVatRatePercent(prisma);
      // toBeCloseTo handles the harmless 0.07 × 100 = 7.000000000000001 float artifact
      expect(result).toBeCloseTo(DEFAULT_VAT_PERCENT, 8);
    });
  });

  describe('warnIfVatKeysCollide — bootstrap orphan-key check', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns when VAT_RATE and vat_pct both present', async () => {
      const prisma = {
        systemConfig: {
          findMany: jest.fn().mockResolvedValue([
            { key: 'VAT_RATE', value: '7' },
            { key: 'vat_pct', value: '0.07' },
          ]),
        },
      } as unknown as Parameters<typeof warnIfVatKeysCollide>[0];

      await warnIfVatKeysCollide(prisma);

      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/orphan key should be removed manually/);
      expect(msg).toMatch(/vat_pct/);
    });

    it('does NOT warn when only VAT_RATE present', async () => {
      const prisma = {
        systemConfig: {
          findMany: jest.fn().mockResolvedValue([{ key: 'VAT_RATE', value: '7' }]),
        },
      } as unknown as Parameters<typeof warnIfVatKeysCollide>[0];

      await warnIfVatKeysCollide(prisma);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT warn when only legacy vat_pct present', async () => {
      const prisma = {
        systemConfig: {
          findMany: jest.fn().mockResolvedValue([{ key: 'vat_pct', value: '0.07' }]),
        },
      } as unknown as Parameters<typeof warnIfVatKeysCollide>[0];

      await warnIfVatKeysCollide(prisma);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('swallows DB errors silently (boot should not crash)', async () => {
      const prisma = {
        systemConfig: {
          findMany: jest.fn().mockRejectedValue(new Error('DB unreachable')),
        },
      } as unknown as Parameters<typeof warnIfVatKeysCollide>[0];

      await expect(warnIfVatKeysCollide(prisma)).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
