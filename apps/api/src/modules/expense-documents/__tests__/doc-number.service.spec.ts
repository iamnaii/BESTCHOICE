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
      getKey: jest.fn().mockResolvedValue(null), // default cycle = daily
    };
    service = new DocNumberService(settings as unknown as SettingsService);
  });

  it('returns EX-YYYYMMDD-0001 for first EXPENSE on given date', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    const num = await service.next(
      tx as Prisma.TransactionClient,
      'EXPENSE',
      new Date('2026-05-10T12:00:00Z'),
    );
    expect(num).toBe('EX-20260510-0001');
  });

  it('increments sequence per type per day', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-0042' });
    const num = await service.next(
      tx as Prisma.TransactionClient,
      'EXPENSE',
      new Date('2026-05-10T12:00:00Z'),
    );
    expect(num).toBe('EX-20260510-0043');
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

  it('acquires advisory lock with deterministic key per (type, cycle, period)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
    );
  });

  it('uses Asia/Bangkok timezone for date boundary (UTC late-night → next BKK day)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    // 2026-05-10 19:00 UTC = 2026-05-11 02:00 BKK
    const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T19:00:00Z'));
    expect(num).toBe('EX-20260511-0001');
  });

  // W4 — explicit throw when seq overflows 4-digit slot.
  it('W4: throws when seq exceeds 9999 for a day', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-9999' });
    await expect(
      service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
    ).rejects.toThrow(/เกิน 9999/);
  });

  it('W4: still works at 9998 → 9999', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-9998' });
    const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(num).toBe('EX-20260510-9999');
  });

  // D1.1.2.3 — reset_cycle (daily / monthly / yearly).
  describe('D1.1.2.3 — doc_number_reset_cycle', () => {
    it('monthly: looks up prior numbers across the whole BKK month', async () => {
      settings.getKey.mockResolvedValue('monthly');
      // Latest doc in May 2026 was issued on May 3, seq 0050.
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260503-0050' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      // New doc dated May 10 picks up at 0051 (sequence shared across May).
      expect(num).toBe('EX-20260510-0051');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-202605');
    });

    it('yearly: looks up prior numbers across the whole BKK year', async () => {
      settings.getKey.mockResolvedValue('yearly');
      // Latest doc in 2026 was issued on Feb 14, seq 0123.
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260214-0123' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0124');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2026');
    });

    it('daily (explicit) behaves identically to default', async () => {
      settings.getKey.mockResolvedValue('daily');
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-0009' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0010');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-20260510');
    });

    it('bad / non-whitelisted cycle value falls back to daily', async () => {
      settings.getKey.mockResolvedValue('weekly');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-20260510');
    });

    it('defensive fallback when SettingsService.getKey throws', async () => {
      settings.getKey.mockRejectedValue(new Error('db down'));
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });

    // Edge cases at period boundaries (UTC midnight on month boundary in BKK).
    it('monthly: BKK new-month boundary starts a fresh sequence', async () => {
      settings.getKey.mockResolvedValue('monthly');
      // First doc in June 2026 — May's 9999 should NOT show up in lookup.
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-06-01T05:00:00Z'));
      expect(num).toBe('EX-20260601-0001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-202606');
    });

    it('yearly: BKK new-year boundary starts a fresh sequence', async () => {
      settings.getKey.mockResolvedValue('yearly');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2027-01-01T05:00:00Z'));
      expect(num).toBe('EX-20270101-0001');
      const findCall = tx.expenseDocument.findFirst.mock.calls[0][0];
      expect(findCall.where.number.startsWith).toBe('EX-2027');
    });
  });

  // D1.1.2.3 — sibling period-bounds helpers.
  describe('D1.1.2.3 — BKK period helpers', () => {
    it('getBkkMonthBounds returns YYYYMM identifier', () => {
      const { yyyymm } = service.getBkkMonthBounds(new Date('2026-05-10T12:00:00Z'));
      expect(yyyymm).toBe('202605');
    });

    it('getBkkMonthBounds spans first → next month UTC', () => {
      const { start, end } = service.getBkkMonthBounds(new Date('2026-05-10T12:00:00Z'));
      // BKK midnight 2026-05-01 = UTC 2026-04-30T17:00Z
      expect(start.toISOString()).toBe('2026-04-30T17:00:00.000Z');
      // BKK midnight 2026-06-01 = UTC 2026-05-31T17:00Z
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
