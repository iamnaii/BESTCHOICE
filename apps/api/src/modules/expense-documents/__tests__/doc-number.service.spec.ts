import { DocNumberService } from '../services/doc-number.service';
import { SettingsService } from '../../settings/settings.service';
import type { Prisma } from '@prisma/client';

describe('DocNumberService', () => {
  let service: DocNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any;

  beforeEach(() => {
    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        findFirst: jest.fn(),
      },
    };
    settings = {
      // default: both keys absent.
      // → cycle defaults to spec `yearly`
      // → format defaults to legacy `PREFIX-YYYYMMDD-NNNN` (pre-#941 behaviour)
      getKey: jest.fn().mockResolvedValue(null),
    };
    service = new DocNumberService(settings as unknown as SettingsService);
  });

  // ---------------------------------------------------------------------------
  // Default — cycle=yearly (spec) + format=YYYYMMDD-NNNN (legacy fallback).
  // Emitted number keeps full date portion; lookup prefix is YYYY-wide so the
  // sequence carries across the year.
  // ---------------------------------------------------------------------------
  describe('default (cycle=yearly + legacy format fallback)', () => {
    it('returns EX-YYYYMMDD-0001 for first EXPENSE of the year', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(
        tx as Prisma.TransactionClient,
        'EXPENSE',
        new Date('2026-05-10T12:00:00Z'),
      );
      expect(num).toBe('EX-20260510-0001');
    });

    it('sequence carries across the year: Feb seq 0123 → May 0124', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260214-0123' });
      const num = await service.next(
        tx as Prisma.TransactionClient,
        'EXPENSE',
        new Date('2026-05-10T12:00:00Z'),
      );
      expect(num).toBe('EX-20260510-0124');
      // Lookup should be YYYY-wide.
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2026');
    });

    it('uses correct prefix per type', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      expect(await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'))).toMatch(/^EX-/);
      expect(await service.next(tx, 'CREDIT_NOTE', new Date('2026-05-10T12:00:00Z'))).toMatch(
        /^CN-/,
      );
      expect(await service.next(tx, 'PAYROLL', new Date('2026-05-10T12:00:00Z'))).toMatch(/^PR-/);
      expect(
        await service.next(tx, 'VENDOR_SETTLEMENT', new Date('2026-05-10T12:00:00Z')),
      ).toMatch(/^SE-/);
    });

    it('acquires advisory lock with deterministic key', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
      );
    });

    it('yearly cycle: different days within same year share same lock key', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      await service.next(tx, 'EXPENSE', new Date('2026-01-15T12:00:00Z'));
      const lockKey1 = tx.$executeRawUnsafe.mock.calls[0][0];
      tx.$executeRawUnsafe.mockClear();
      await service.next(tx, 'EXPENSE', new Date('2026-11-15T12:00:00Z'));
      const lockKey2 = tx.$executeRawUnsafe.mock.calls[0][0];
      expect(lockKey1).toBe(lockKey2);
    });

    it('uses Asia/Bangkok timezone for date boundary', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      // 2026-05-10 19:00 UTC = 2026-05-11 02:00 BKK
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T19:00:00Z'));
      expect(num).toBe('EX-20260511-0001');
    });

    // W4 — explicit throw when seq overflows 4-digit slot (legacy format).
    it('W4: throws when seq exceeds 9999', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-9999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 9999/);
    });
  });

  // ---------------------------------------------------------------------------
  // D1.1.2.3 — reset_cycle whitelist (3 cycles + bad fallback).
  // ---------------------------------------------------------------------------
  describe('D1.1.2.3 — doc_number_reset_cycle', () => {
    it('daily: looks up prior numbers per-day only', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'daily' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-0009' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0010');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-20260510');
    });

    it('monthly: looks up prior numbers across the whole BKK month', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'monthly' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260503-0050' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0051');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-202605');
    });

    it('yearly (spec default): looks up prior numbers across the whole BKK year', async () => {
      // No SystemConfig set → defaults to yearly per spec.
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260214-0123' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0124');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2026');
    });

    it('bad / non-whitelisted cycle value falls back to spec default (yearly)', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'weekly' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260214-0123' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0124');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2026');
    });

    it('defensive fallback when SettingsService.getKey throws', async () => {
      settings.getKey.mockRejectedValue(new Error('db down'));
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      // Both keys throw → cycle=yearly (spec), format=legacy
      expect(num).toBe('EX-20260510-0001');
    });

    // Period boundary edges.
    it('monthly: BKK new-month boundary starts a fresh sequence', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'monthly' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-06-01T05:00:00Z'));
      expect(num).toBe('EX-20260601-0001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-202606');
    });

    it('yearly: BKK new-year boundary starts a fresh sequence', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2027-01-01T05:00:00Z'));
      expect(num).toBe('EX-20270101-0001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2027');
    });
  });

  // ---------------------------------------------------------------------------
  // C6.1 composition with D1.1.2.2 — the emit's date portion + seq width must
  // follow `doc_number_format`. When sibling PR #941 has not yet merged, this
  // PR falls back to legacy `PREFIX-YYYYMMDD-NNNN`. When both merge, the spec
  // composition yields `EX-2605-001` (yearly cycle + YYMM format).
  // ---------------------------------------------------------------------------
  describe('C6.1 composition with D1.1.2.2 doc_number_format', () => {
    it('legacy format fallback: format key absent → YYYYMMDD-NNNN emission', async () => {
      // Only cycle key set (e.g. owner toggled cycle via #947 but #941 not merged).
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'yearly' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });

    it('both merged: format=YYMM-NNN + cycle=yearly → EX-2605-001 (spec compose)', async () => {
      settings.getKey.mockImplementation(async (k: string) => {
        if (k === 'doc_number_format') return 'PREFIX-YYMM-NNN';
        if (k === 'doc_number_reset_cycle') return 'yearly';
        return null;
      });
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-001');
      // Lookup uses 2-digit-year + yearly → YY prefix.
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-26');
    });

    it('compose: format=YYYY-NNNNNN + cycle=yearly → EX-2026-000001', async () => {
      settings.getKey.mockImplementation(async (k: string) => {
        if (k === 'doc_number_format') return 'PREFIX-YYYY-NNNNNN';
        if (k === 'doc_number_reset_cycle') return 'yearly';
        return null;
      });
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2026-000001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2026');
    });

    it('compose: format=YYMM-NNN + cycle=monthly → EX-2605-001, lookup EX-2605', async () => {
      settings.getKey.mockImplementation(async (k: string) => {
        if (k === 'doc_number_format') return 'PREFIX-YYMM-NNN';
        if (k === 'doc_number_reset_cycle') return 'monthly';
        return null;
      });
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2605-050' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-15T12:00:00Z'));
      expect(num).toBe('EX-2605-051');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2605');
    });

    it('bad format value falls back to legacy YYYYMMDD-NNNN', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'BAD-FORMAT-XYZ' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });
  });

  // ---------------------------------------------------------------------------
  // D1.1.2.3 — BKK period helper methods (unchanged).
  // ---------------------------------------------------------------------------
  describe('D1.1.2.3 — BKK period helpers', () => {
    it('getBkkMonthBounds returns YYYYMM identifier', () => {
      const { yyyymm } = service.getBkkMonthBounds(new Date('2026-05-10T12:00:00Z'));
      expect(yyyymm).toBe('202605');
    });

    it('getBkkMonthBounds spans first → next month UTC', () => {
      const { start, end } = service.getBkkMonthBounds(new Date('2026-05-10T12:00:00Z'));
      expect(start.toISOString()).toBe('2026-04-30T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-05-31T17:00:00.000Z');
    });

    it('getBkkYearBounds returns YYYY identifier', () => {
      const { yyyy } = service.getBkkYearBounds(new Date('2026-05-10T12:00:00Z'));
      expect(yyyy).toBe('2026');
    });

    it('getBkkYearBounds spans Jan 1 → next Jan 1 UTC', () => {
      const { start, end } = service.getBkkYearBounds(new Date('2026-05-10T12:00:00Z'));
      expect(start.toISOString()).toBe('2025-12-31T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });
  });
});
